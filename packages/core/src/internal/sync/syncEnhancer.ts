import { IS_DEV } from '#env';
import { type InternalUnsubscribeFn, wrapCascadeStateSubscription } from '../cascadeSubscriptions';
import { applyStateUpdate } from '../../store/stateUpdate';
import { FieldMetadata, NormalizedSyncConfig, SyncHandle, SyncStateKey, SyncUpdate, SyncValues } from '../../sync/types';
import { StateCreator, SubscribeArgs, SubscribeOverloads } from '../../types';
import { hasOwn } from '../../types/utils';
import { nullObject } from '../../utils/core';
import { isPromiseLike } from '../../utils/promiseUtils';
import { getStorageConfig } from '../config';
import { StoresError } from '../errors';
import { logger } from '../logger';

// ============ Constants ====================================================== //

/** Index of `timestamp` in `FieldMetadata` tuples. */
const TIMESTAMP = 0;

/** Index of `sessionId` in `FieldMetadata` tuples. */
const SESSION_ID = 1;

// ============ Sync Enhancer ================================================== //

export type SyncContext = {
  isAsync: boolean;
  clearFieldTimestamps: (snapshot: Record<string, number> | undefined) => void;
  getFieldTimestampSnapshot: () => Record<string, number> | undefined;
  getIsApplyingRemote: () => boolean;
  getSessionId: () => string | undefined;
  getTimestamp: () => number | undefined;
  mergeFieldTimestamps: (fields: Record<string, number>) => void;
  onHydrationComplete: (() => void) | undefined;
  onHydrationFlushEnd: (() => void) | undefined;
  setIsApplyingRemote: (value: boolean) => void;
  setSessionId: (sessionId: string) => void;
  setTimestamp: (timestamp: number) => void;
  setWithoutPersist:
    | (<_T extends (..._: unknown[]) => void | Promise<void>, Args extends unknown[]>(..._: Args) => void | Promise<void>)
    | undefined;
};

type PendingUpdate<T extends Record<string, unknown>> = {
  keys: SyncStateKey<T>[];
  replace: boolean;
  timestamp: number;
  values: SyncValues<T>;
};

export function createSyncedStateCreator<T extends Record<string, unknown>>(
  stateCreator: StateCreator<T>,
  config: NormalizedSyncConfig<T>,
  syncContext: SyncContext | undefined
): StateCreator<T> {
  const resolvedEngine = config.engine ?? getStorageConfig().syncEngine;

  return (set, get, api) => {
    const lastWrites = new Map<SyncStateKey<T>, FieldMetadata>();
    const pendingRemoteUpdates: SyncUpdate<T>[] = [];
    const pendingUpdates: PendingUpdate<T>[] = [];

    let handle: SyncHandle<T> | null = null;
    let isApplyingRemote = false;
    let isHydrated = false;
    let latestTimestamp = 0;
    let syncKeySet: Set<SyncStateKey<T>> | null = null;
    let syncKeys: ReadonlyArray<SyncStateKey<T>> = [];

    let applyPromiseChain: Promise<void> = Promise.resolve();
    let canProcessRemoteUpdates = !syncContext?.isAsync;

    function generateTimestamp(): number {
      const candidate = Date.now();
      const next = candidate > latestTimestamp ? candidate : latestTimestamp + 1;
      latestTimestamp = next;
      return next;
    }

    function setPersistMetadata(timestamp: number, keys: readonly SyncStateKey<T>[]): void {
      if (!syncContext || !resolvedEngine.sessionId) return;

      syncContext.setSessionId(resolvedEngine.sessionId);
      syncContext.setTimestamp(timestamp);

      if (keys.length > 0) {
        const timestamps: Record<string, number> = nullObject();
        for (const key of keys) timestamps[String(key)] = timestamp;
        syncContext.mergeFieldTimestamps(timestamps);
      }
    }

    function queueOrPublish(update: PendingUpdate<T>): void {
      const sessionId = resolvedEngine.sessionId;
      for (const key of update.keys) lastWrites.set(key, [update.timestamp, sessionId]);

      if (!handle || !isHydrated) {
        pendingUpdates.push(update);
        return;
      }
      handle.publish?.({ replace: update.replace, sessionId, timestamp: update.timestamp, values: update.values });
    }

    function flushPendingUpdates(): void {
      if (!handle || !pendingUpdates.length) return;

      for (const pending of pendingUpdates) {
        const sessionId = resolvedEngine.sessionId;
        for (const key of pending.keys) {
          lastWrites.set(key, [pending.timestamp, sessionId]);
        }
        setPersistMetadata(pending.timestamp, pending.keys);
        handle.publish?.({ replace: pending.replace, sessionId, timestamp: pending.timestamp, values: pending.values });
      }
      pendingUpdates.length = 0;
    }

    function enhancedSet(update: Parameters<typeof set>[0], replace?: boolean): void | Promise<void> {
      if (isApplyingRemote || !syncKeySet) return replace ? set(update, replace) : set(update);

      const timestamp = generateTimestamp();
      let publishKeys: SyncStateKey<T>[] = [];
      let publishValues: SyncValues<T> = nullObject();

      const maybePromise: void | Promise<void> = replace ? set(wrappedUpdate, true) : set(wrappedUpdate);

      function wrappedUpdate(state: T): T {
        const newState = applyStateUpdate(state, update, replace);

        for (const key of syncKeys) {
          if (!Object.is(newState[key], state[key])) {
            publishKeys.push(key);
            publishValues[key] = newState[key];
          }
        }

        if (publishKeys.length) setPersistMetadata(timestamp, publishKeys);
        return newState;
      }

      function publish(): void {
        if (!publishKeys.length) return;
        queueOrPublish({ keys: publishKeys, replace: replace ?? false, values: publishValues, timestamp });
      }

      if (isPromiseLike(maybePromise)) return maybePromise.finally(publish);

      publish();
      return maybePromise;
    }

    const originalSet = api.setState;
    api.setState = enhancedSet;
    const state = stateCreator(enhancedSet, get, api);

    syncKeys = config.fields ?? deriveDataKeys(state);
    if (!syncKeys.length) return state;
    syncKeySet = new Set(syncKeys);

    async function processUpdate(update: SyncUpdate<T>): Promise<void> {
      latestTimestamp = Math.max(latestTimestamp, update.timestamp);
      const updates: SyncValues<T> = nullObject();
      const currentState = get();
      const updateTimestamp = update.timestamp;
      let keysToClear: SyncStateKey<T>[] | undefined;

      if (update.replace) {
        for (const key of syncKeys) {
          if (hasOwn(update.values, key)) continue;
          const current = lastWrites.get(key);
          if (!shouldApplyUpdate(current, updateTimestamp, update.sessionId)) continue;
          (keysToClear ??= []).push(key);
        }
      }

      for (const key of syncKeys) {
        if (!hasSyncValue(update.values, key) || !syncKeySet?.has(key)) continue;

        const current = lastWrites.get(key);
        if (!shouldApplyUpdate(current, updateTimestamp, update.sessionId)) continue;

        const mergeFunction = config.merge?.[key];
        if (mergeFunction) {
          const incomingValue = update.values[key];
          const currentValue = currentState[key];
          if (incomingValue !== undefined) {
            const mergedValue = mergeFunction(incomingValue, currentValue, currentState, update.values);
            const referenceValue = currentValue !== undefined ? currentValue : incomingValue;
            if (!isSameType(mergedValue, referenceValue)) {
              logger.error(
                new StoresError(
                  `[sync] Merge function for field "${String(key)}" returned ${describeType(mergedValue)} but expected ${describeType(referenceValue)}`
                )
              );
              return;
            }
            updates[key] = mergedValue;
            lastWrites.set(key, [updateTimestamp, update.sessionId]);
          }
        } else {
          updates[key] = update.values[key];
          lastWrites.set(key, [updateTimestamp, update.sessionId]);
        }
      }

      const hasUpdates = Object.keys(updates).length > 0;
      if (!hasUpdates && !keysToClear?.length) return;

      isApplyingRemote = true;
      syncContext?.setIsApplyingRemote(true);
      try {
        if (update.replace) {
          const nextState = { ...currentState };
          let mutated = false;

          if (keysToClear?.length) {
            mutated = true;
            for (const key of keysToClear) {
              delete nextState[key];
              lastWrites.delete(key);
            }
          }

          for (const key in updates) {
            if (!hasOwn(updates, key)) continue;
            const value = updates[key];
            if (value === undefined) continue;
            if (!Object.is(nextState[key], value)) mutated = true;
            const typedObject: Record<string, unknown> = nextState;
            typedObject[key] = value;
          }

          if (!mutated) return;
          await (syncContext?.setWithoutPersist ?? originalSet)(nextState, true);
        } else {
          await (syncContext?.setWithoutPersist ?? originalSet)(updates);
        }
      } finally {
        isApplyingRemote = false;
        syncContext?.setIsApplyingRemote(false);
      }
    }

    function scheduleProcessUpdate(update: SyncUpdate<T>): void {
      if (syncContext?.isAsync) applyPromiseChain = applyPromiseChain.then(() => processUpdate(update));
      else void processUpdate(update);
    }

    function flushPendingRemoteUpdates(): void {
      if (!pendingRemoteUpdates.length) return;
      const queued = pendingRemoteUpdates.slice();
      pendingRemoteUpdates.length = 0;
      for (const queuedUpdate of queued) scheduleProcessUpdate(queuedUpdate);
    }

    handle = resolvedEngine.register<T>({
      apply: update => {
        if (!canProcessRemoteUpdates) {
          pendingRemoteUpdates.push(update);
          return;
        }
        scheduleProcessUpdate(update);
      },
      fields: syncKeys,
      getState: get,
      key: config.key,
    });

    if (handle?.onFirstSubscribe || handle?.onLastUnsubscribe) {
      const syncHandle = handle;
      let subscriberCount = 0;
      const originalSubscribe: SubscribeOverloads<T> = api.subscribe;

      function trackSubscription(unsubscribe: InternalUnsubscribeFn): InternalUnsubscribeFn {
        if (!subscriberCount) syncHandle.onFirstSubscribe?.();
        subscriberCount += 1;

        return skipAbortFetch => {
          unsubscribe(skipAbortFetch);
          subscriberCount -= 1;
          if (!subscriberCount) {
            queueMicrotask(() => {
              if (!subscriberCount) syncHandle.onLastUnsubscribe?.();
            });
          }
        };
      }

      api.subscribe = (...args: SubscribeArgs<T>) => {
        return trackSubscription(args.length === 1 ? originalSubscribe(args[0]) : originalSubscribe(args[0], args[1], args[2]));
      };

      wrapCascadeStateSubscription(api, originalSubscribeCascadeState => {
        return listener => trackSubscription(originalSubscribeCascadeState(listener));
      });
    }

    function onHydrationComplete(): void {
      isHydrated = true;
      flushPendingUpdates();
    }

    function onHydrationFlushEnd(): void {
      canProcessRemoteUpdates = true;
      flushPendingRemoteUpdates();
    }

    /**
     * Determine when to mark as hydrated:
     *   1. If async storage: wait for persist middleware's onRehydrateStorage callback
     *   2. If sync engine provides onHydrated: use that
     *   3. Otherwise: immediate
     */
    if (syncContext?.isAsync) {
      // Wait for external hydration signal from persist middleware
      syncContext.onHydrationComplete = onHydrationComplete;
      syncContext.onHydrationFlushEnd = onHydrationFlushEnd;
    } else if (handle.onHydrated) {
      // Sync engine provides its own hydration callback
      handle.onHydrated(onHydrationComplete);
      onHydrationFlushEnd();
    } else {
      // No hydration needed
      onHydrationComplete();
      onHydrationFlushEnd();
    }

    return state;
  };
}

// ============ Sync Context Builder =========================================== //

/** Creates the context shared by sync, persistence, and storage hydration. */
export function createSyncContext(isAsync: boolean): SyncContext {
  let currentSessionId: string | undefined;
  let currentTimestamp: number | undefined;
  let fieldTimestampAccumulator: Record<string, number> | undefined;
  let isApplyingRemoteSync = false;

  function clearFieldTimestamps(snapshot: Record<string, number> | undefined): void {
    if (!snapshot || !fieldTimestampAccumulator) return;
    for (const entry of Object.entries(snapshot)) {
      const key = entry[0];
      const snapshotTimestamp = entry[1];
      if (fieldTimestampAccumulator[key] === snapshotTimestamp) {
        delete fieldTimestampAccumulator[key];
      }
    }
    if (!Object.keys(fieldTimestampAccumulator).length) fieldTimestampAccumulator = undefined;
  }

  function getFieldTimestampSnapshot(): Record<string, number> | undefined {
    if (!fieldTimestampAccumulator) return undefined;
    return { ...fieldTimestampAccumulator };
  }

  function mergeFieldTimestamps(fields: Record<string, number>): void {
    if (!fieldTimestampAccumulator) {
      fieldTimestampAccumulator = { ...fields };
      return;
    }
    for (const entry of Object.entries(fields)) {
      const key = entry[0];
      const timestamp = entry[1];
      const current = fieldTimestampAccumulator[key];
      if (current === undefined || timestamp > current) {
        fieldTimestampAccumulator[key] = timestamp;
      }
    }
  }

  return {
    isAsync,
    clearFieldTimestamps,
    getFieldTimestampSnapshot,
    getIsApplyingRemote: () => isApplyingRemoteSync,
    getSessionId: () => currentSessionId,
    getTimestamp: () => currentTimestamp,
    mergeFieldTimestamps,
    onHydrationComplete: undefined,
    onHydrationFlushEnd: undefined,
    setIsApplyingRemote: value => (isApplyingRemoteSync = value),
    setSessionId: sessionId => (currentSessionId = sessionId),
    setTimestamp: timestamp => (currentTimestamp = timestamp),
    setWithoutPersist: undefined,
  };
}

// ============ Utilities ====================================================== //

/**
 * Determines whether an incoming update supersedes the last known write.
 * Compares timestamp first and falls back to lexicographical sessionId comparison for ties.
 * @returns `true` when the update should be applied, `false` if it should be ignored.
 */
function shouldApplyUpdate(current: FieldMetadata | undefined, updateTimestamp: number, sessionId: string): boolean {
  if (!current) return true;
  const currentTimestamp = current[TIMESTAMP];
  const currentSessionId = current[SESSION_ID];

  // Timestamp first
  if (updateTimestamp < currentTimestamp) return false;
  if (updateTimestamp > currentTimestamp) return true;

  // Lexicographical sessionId comparison for ties
  return sessionId > currentSessionId;
}

function deriveDataKeys<T extends Record<string, unknown>>(state: T): SyncStateKey<T>[] {
  const keys: SyncStateKey<T>[] = [];
  for (const key of Object.keys(state)) if (isSyncStateKey(state, key)) keys.push(key);
  return keys;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  const valueType = typeof value;
  if (valueType === 'object') return Object.prototype.toString.call(value);
  return valueType;
}

function isSameType(a: unknown, b: unknown): boolean {
  if (!IS_DEV) return true;
  if (a === null || b === null) return a === b;
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return false;
  if (typeA !== 'object') return true;
  const tagA = Object.prototype.toString.call(a);
  const tagB = Object.prototype.toString.call(b);
  return tagA === tagB;
}

// ============ Type Guards ==================================================== //

function hasSyncValue<T extends Record<string, unknown>, K extends SyncStateKey<T>>(
  values: SyncValues<T>,
  key: K
): values is SyncValues<T> & Record<K, T[K]> {
  return hasOwn(values, key);
}

function isSyncStateKey<T extends Record<string, unknown>>(state: T, key: string): key is SyncStateKey<T> {
  return typeof state[key] !== 'function';
}
