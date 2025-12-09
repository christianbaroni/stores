import { StoreApi } from 'zustand';
import { SetState, SetStateOverloads } from '../../types';
import { applyStateUpdate } from '../../utils/storeUtils';
import { SyncContext } from '../syncEnhancer';
import { SyncEngine, SyncHandle, SyncRegistration, SyncUpdate } from '../types';

export type MockStoreApi<S> = {
  api: StoreApi<S>;
  get: jest.Mock<S, []>;
  set: SetStateOverloads<S>;
  state: { current: S };
};

export function createMockStore<S>(initialState: S): MockStoreApi<S> {
  const state = { current: initialState };

  const setImpl: SetState<S> = jest.fn((...args) => {
    const resolved = applyStateUpdate(state.current, ...args);
    state.current = resolved;
  });

  const get = jest.fn(() => state.current);

  const api: StoreApi<S> = {
    setState: setImpl,
    getState: get,
    getInitialState: get,
    subscribe: jest.fn(() => jest.fn()),
  };

  return { api, get, set: setImpl, state };
}

export function createMockSyncContext(overrides: Partial<SyncContext> = {}): {
  context: SyncContext;
  fieldTimestamps: Record<string, number>;
} {
  const fieldTimestamps: Record<string, number> = {};

  const mergeFieldTimestamps =
    overrides.mergeFieldTimestamps ??
    ((fields: Record<string, number>) => {
      for (const [key, timestamp] of Object.entries(fields)) fieldTimestamps[key] = timestamp;
    });

  const clearFieldTimestamps =
    overrides.clearFieldTimestamps ??
    ((snapshot: Record<string, number> | undefined) => {
      if (!snapshot) return;
      for (const [key, timestamp] of Object.entries(snapshot)) {
        if (fieldTimestamps[key] === timestamp) delete fieldTimestamps[key];
      }
    });

  const getFieldTimestampSnapshot =
    overrides.getFieldTimestampSnapshot ??
    (() => {
      if (!Object.keys(fieldTimestamps).length) return undefined;
      return { ...fieldTimestamps };
    });

  const context: SyncContext = {
    isAsync: overrides.isAsync ?? false,
    getFieldTimestampSnapshot,
    getIsApplyingRemote: overrides.getIsApplyingRemote ?? (() => false),
    getSessionId: overrides.getSessionId ?? (() => 'mock-session'),
    getTimestamp: overrides.getTimestamp ?? (() => Date.now()),
    onHydrationComplete: overrides.onHydrationComplete,
    onHydrationFlushEnd: overrides.onHydrationFlushEnd,
    mergeFieldTimestamps,
    clearFieldTimestamps,
    setIsApplyingRemote: overrides.setIsApplyingRemote ?? (() => {}),
    setSessionId: overrides.setSessionId ?? (() => {}),
    setTimestamp: overrides.setTimestamp ?? (() => {}),
    setWithoutPersist: overrides.setWithoutPersist,
  };

  return { context, fieldTimestamps };
}

export function createMockEngine<T extends Record<string, unknown>>(
  handleOverrides: Partial<SyncHandle<T>> = {}
): {
  engine: SyncEngine;
  handle: SyncHandle<T>;
  onRegister: jest.Mock<SyncHandle<T>, [SyncRegistration<T>]>;
} {
  const handle: SyncHandle<T> = {
    destroy: jest.fn(),
    publish: jest.fn(),
    onHydrated: jest.fn(),
    ...handleOverrides,
  };

  const onRegister: jest.Mock<SyncHandle<T>, [SyncRegistration<T>]> = jest.fn(_registration => handle);

  const engine: SyncEngine = {
    sessionId: 'mock-session',
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    register: onRegister as SyncEngine['register'],
  };
  return { engine, handle, onRegister };
}

export function capturePublishedUpdates<T extends Record<string, unknown>>(handle: SyncHandle<T>): SyncUpdate<T>[] {
  const updates: SyncUpdate<T>[] = [];
  const originalPublish = handle.publish;
  handle.publish = update => {
    updates.push(update);
    originalPublish?.(update);
  };
  return updates;
}

export async function flushMacrotask(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

export async function flushMicrotasks(times = 1): Promise<void> {
  if (times === 1) return Promise.resolve();
  let promise = Promise.resolve();
  for (let i = 0; i < times; i++) promise = promise.then(() => Promise.resolve());
  await promise;
}

export function triggerOnHydrated<T extends Record<string, unknown>>(handle: SyncHandle<T>): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const onHydrated = handle.onHydrated as jest.Mock<(callback: () => void) => void>;
  const callback = onHydrated.mock.calls[0]?.[0];
  callback?.();
}
