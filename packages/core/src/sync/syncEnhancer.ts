import { StoresError, logger } from '../logger';
import { StateCreator } from '../types';
import { NormalizedSyncConfig, SyncEngine, SyncHandle, SyncStateKey, SyncValues } from './types';

// ============ Sync Enhancer ================================================== //

type PendingUpdate<T extends Record<string, unknown>> = {
  keys: SyncStateKey<T>[];
  replace: boolean;
  values: SyncValues<T>;
};

export function createSyncedStateCreator<T extends Record<string, unknown>>(
  stateCreator: StateCreator<T>,
  config: NormalizedSyncConfig<T>,
  defaultEngine: SyncEngine
): StateCreator<T> {
  const resolvedEngine = config.engine ?? defaultEngine;

  return (set, get, api) => {
    const lastWriteTimes = new Map<SyncStateKey<T>, number>();
    const pendingUpdates: PendingUpdate<T>[] = [];

    let handle: SyncHandle<T> | null = null;
    let isApplyingRemote = false;
    let isHydrated = false;
    let latestTimestamp = 0;
    let syncKeySet: Set<SyncStateKey<T>> | null = null;
    let syncKeys: ReadonlyArray<SyncStateKey<T>> = [];

    const generateTimestamp = (): number => {
      const candidate = Date.now();
      const next = candidate > latestTimestamp ? candidate : latestTimestamp + 1;
      latestTimestamp = next;
      return next;
    };

    const queueOrPublish = (update: PendingUpdate<T>) => {
      const timestamp = generateTimestamp();
      for (const key of update.keys) lastWriteTimes.set(key, timestamp);
      const values = { ...update.values };
      if (!handle || !isHydrated) {
        pendingUpdates.push({ keys: [...update.keys], replace: update.replace, values });
        return;
      }
      handle.publish({ replace: update.replace, timestamp, values });
    };

    const flushPendingUpdates = () => {
      if (!handle || pendingUpdates.length === 0) return;
      for (const pending of pendingUpdates) {
        const timestamp = generateTimestamp();
        const values = { ...pending.values };
        for (const key of pending.keys) lastWriteTimes.set(key, timestamp);
        handle.publish({ replace: pending.replace, timestamp, values });
      }
      pendingUpdates.length = 0;
    };

    const enhancedSet: typeof set = function (update: Parameters<typeof set>[0], replace?: boolean): void {
      const previousState = get();

      if (!replace) {
        set(update);
      } else {
        set(update, replace);
      }

      if (isApplyingRemote || !syncKeySet) return;

      const isReplace = replace === true;
      const nextState = get();
      const nextValues: SyncValues<T> = Object.create(null);

      if (isReplace) {
        for (const key of syncKeys) {
          nextValues[key] = nextState[key];
        }
      } else {
        for (const key of syncKeys) {
          if (Object.is(nextState[key], previousState[key])) continue;
          nextValues[key] = nextState[key];
        }
      }

      const keys = Object.keys(nextValues) as SyncStateKey<T>[];
      if (!keys.length) return;

      queueOrPublish({ keys, replace: isReplace, values: nextValues });
    };

    const store = stateCreator(enhancedSet, get, api);

    syncKeys = config.fields ?? deriveDataKeys(store);
    syncKeySet = new Set(syncKeys);

    if (!syncKeys.length) return store;

    handle = resolvedEngine.register<T>({
      apply: update => {
        latestTimestamp = Math.max(latestTimestamp, update.timestamp);
        const updates: SyncValues<T> = Object.create(null);
        const currentState = get();
        const keysToClear: SyncStateKey<T>[] = [];
        const incomingTimestamp = update.timestamp;

        if (update.replace) {
          for (const key of syncKeys) {
            if (hasSyncValue(update.values, key)) continue;
            const lastWrite = lastWriteTimes.get(key) ?? 0;
            if (incomingTimestamp <= lastWrite) continue;
            keysToClear.push(key);
          }
        }

        for (const key of syncKeys) {
          if (!hasSyncValue(update.values, key)) continue;
          if (!syncKeySet?.has(key)) continue;
          const lastWrite = lastWriteTimes.get(key) ?? 0;
          if (incomingTimestamp <= lastWrite) continue;

          const mergeFn = config.merge?.[key];
          if (mergeFn) {
            const incomingValue = update.values[key];
            const currentValue = currentState[key];
            if (incomingValue !== undefined) {
              const mergedValue = mergeFn(incomingValue, currentValue, currentState, update.values);
              const referenceValue = currentValue !== undefined ? currentValue : incomingValue;
              if (!isSameType(mergedValue, referenceValue)) {
                logger.error(
                  new StoresError(
                    `[sync] Merge function for field "${String(key)}" returned ${describeType(mergedValue)} but expected ${describeType(referenceValue)}`
                  )
                );
                continue;
              }
              updates[key] = mergedValue;
              lastWriteTimes.set(key, incomingTimestamp);
            }
          } else {
            updates[key] = update.values[key];
            lastWriteTimes.set(key, incomingTimestamp);
          }
        }

        const hasUpdates = Object.keys(updates).length > 0;
        if (!hasUpdates && !keysToClear.length) return;

        isApplyingRemote = true;
        try {
          if (update.replace) {
            const nextState = { ...currentState };
            for (const key of keysToClear) {
              delete nextState[key];
              lastWriteTimes.delete(key);
            }
            Object.assign(nextState, updates);
            set(() => nextState, true);
          } else {
            set(updates, false);
          }
        } finally {
          isApplyingRemote = false;
        }
      },
      fields: syncKeys,
      getState: get,
      key: config.key,
    });

    if (handle.onHydrated) {
      handle.onHydrated(() => {
        isHydrated = true;
        flushPendingUpdates();
      });
    } else {
      isHydrated = true;
      flushPendingUpdates();
    }

    return store;
  };
}

function deriveDataKeys<T extends Record<string, unknown>>(state: T): SyncStateKey<T>[] {
  const keys: SyncStateKey<T>[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'function') continue;
    keys.push(key as SyncStateKey<T>);
  }
  return keys;
}

function hasSyncValue<T extends Record<string, unknown>, K extends SyncStateKey<T>>(
  values: SyncValues<T>,
  key: K
): values is SyncValues<T> & Record<K, T[K]> {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function isSameType(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return false;
  if (typeA !== 'object') return true;
  const tagA = Object.prototype.toString.call(a);
  const tagB = Object.prototype.toString.call(b);
  return tagA === tagB;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  const valueType = typeof value;
  if (valueType === 'object') return Object.prototype.toString.call(value);
  return valueType;
}
