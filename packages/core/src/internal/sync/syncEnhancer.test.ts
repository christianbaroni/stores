import { flushMicrotasks } from '../../async.testUtils';
import { SUBSCRIBE_CASCADE_STATE, type CascadeStateSubscribable } from '../cascadeSubscriptions';
import { applySetState, applyStateUpdate } from '../../store/stateUpdate';
import { StoreApi } from '../../store/types';
import { NormalizedSyncConfig, SyncEngine, SyncHandle, SyncRegistration, SyncUpdate } from '../../sync/types';
import { SetStateArgs, StateCreator } from '../../types';
import { SyncContext, createSyncContext, createSyncedStateCreator } from './syncEnhancer';

type CounterState = { count: number };
type HydratableSyncHandle = SyncHandle<Record<string, unknown>> & {
  triggerHydrated: () => void;
};

type StoreApiHarness<S> = {
  api: StoreApi<S> & CascadeStateSubscribable<S>;
  state: { current: S };
};

type SyncEngineHarness = {
  engine: SyncEngine;
  getRegistration: () => SyncRegistration<Record<string, unknown>>;
  handle: HydratableSyncHandle;
  publishedUpdates: SyncUpdate<Record<string, unknown>>[];
};

function registerStore<T extends Record<string, unknown>>(
  config: NormalizedSyncConfig<T>,
  stateCreator: StateCreator<T>,
  initialState: T,
  overrides: {
    handle?: Partial<HydratableSyncHandle>;
    isAsync?: boolean;
  } = {}
): {
  registration: SyncRegistration<Record<string, unknown>>;
  store: StoreApiHarness<T>;
  publishedUpdates: SyncUpdate<Record<string, unknown>>[];
  context: SyncContext;
  handle: HydratableSyncHandle;
} {
  const { engine, getRegistration, handle, publishedUpdates } = createSyncEngineHarness(overrides.handle);
  const context = createSyncContext(overrides.isAsync ?? false);
  const syncedStateCreator = createSyncedStateCreator(stateCreator, { ...config, engine }, context);
  const store = createStoreApiHarness<T>(initialState);
  const resolvedState = syncedStateCreator(store.api.setState, store.api.getState, store.api);
  store.state.current = resolvedState;

  if (context.isAsync) {
    context.setWithoutPersist = store.api.setState;
  }

  const registration = getRegistration();

  return { registration, store, publishedUpdates, context, handle };
}

function createStoreApiHarness<S>(initialState: S): StoreApiHarness<S> {
  const state = { current: initialState };

  function get(): S {
    return state.current;
  }

  function set(...args: SetStateArgs<S>): void {
    state.current = applyStateUpdate<S>(state.current, args[0], args[1]);
  }

  function subscribeCascadeState(): (skipAbortFetch?: boolean) => void {
    return () => undefined;
  }

  const api: StoreApi<S> & CascadeStateSubscribable<S> = {
    [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
    setState: set,
    getState: get,
    getInitialState: get,
    subscribe: () => () => {},
  };

  return { api, state };
}

function createSyncEngineHarness(handleOverrides?: Partial<HydratableSyncHandle>): SyncEngineHarness {
  const handle = createHydratableSyncHandle(handleOverrides);
  const publishedUpdates: SyncUpdate<Record<string, unknown>>[] = [];
  let registration: SyncRegistration<Record<string, unknown>> | undefined;

  handle.publish = update => {
    publishedUpdates.push(update);
  };

  const engine: SyncEngine = {
    sessionId: 'mock-session',
    register<T extends Record<string, unknown>>(nextRegistration: SyncRegistration<T>): SyncHandle<T> {
      setRegistration(nextRegistration);
      return handle;
    },
  };

  function getRegistration(): SyncRegistration<Record<string, unknown>> {
    if (!registration) throw new Error('Expected sync engine to register a store.');
    return registration;
  }

  return { engine, getRegistration, handle, publishedUpdates };

  function setRegistration<T extends Record<string, unknown>>(nextRegistration: SyncRegistration<T>): void;
  function setRegistration(nextRegistration: SyncRegistration<Record<string, unknown>>): void {
    registration = nextRegistration;
  }
}

function createHydratableSyncHandle(overrides: Partial<HydratableSyncHandle> = {}): HydratableSyncHandle {
  let hydrationCallback: (() => void) | undefined;

  return {
    destroy: () => {},
    publish: () => {},
    onHydrated: callback => {
      hydrationCallback = callback;
    },
    triggerHydrated: () => {
      hydrationCallback?.();
    },
    ...overrides,
  };
}

describe('createSyncedStateCreator', () => {
  describe('local update tracking', () => {
    it('publishes pending local updates once hydration completes', async () => {
      let enhancedSet: ((partial: Partial<CounterState>) => void) | undefined;
      const baseCreator: StateCreator<CounterState> = set => {
        enhancedSet = set;
        return { count: 0 };
      };

      const config: NormalizedSyncConfig<CounterState> = { key: 'counter' };
      const { publishedUpdates, handle } = registerStore(config, baseCreator, { count: 0 });

      expect(enhancedSet).toBeDefined();
      enhancedSet?.({ count: 1 });

      await flushMicrotasks();
      expect(publishedUpdates).toHaveLength(0);

      handle.triggerHydrated();
      await flushMicrotasks();

      expect(publishedUpdates).toHaveLength(1);
      expect(publishedUpdates[0].values).toEqual({ count: 1 });
    });

    it('records field timestamps for modified keys', () => {
      let setFn: ((partial: Partial<{ count: number; label: string }>) => void) | undefined;
      const baseCreator: StateCreator<{ count: number; label: string }> = set => {
        setFn = set;
        return { count: 0, label: 'initial' };
      };

      const config: NormalizedSyncConfig<{ count: number; label: string }> = { key: 'metadata-test' };
      const { context, handle } = registerStore(config, baseCreator, { count: 0, label: 'initial' });

      handle.triggerHydrated();
      setFn?.({ count: 5 });
      setFn?.({ label: 'updated' });

      const fieldSnapshot = context.getFieldTimestampSnapshot();
      expect(fieldSnapshot ? Object.keys(fieldSnapshot) : []).toEqual(expect.arrayContaining(['count', 'label']));
    });

    it('ignores updates when synced fields do not change', async () => {
      let setFn: ((partial: Partial<{ count: number; note: string }>) => void) | undefined;
      const baseCreator: StateCreator<{ count: number; note: string }> = set => {
        setFn = set;
        return { count: 0, note: 'start' };
      };

      const config: NormalizedSyncConfig<{ count: number; note: string }> = { key: 'no-op', fields: ['count'] };
      const { publishedUpdates, handle, context } = registerStore(config, baseCreator, { count: 0, note: 'start' });

      handle.triggerHydrated();
      setFn?.({ note: 'updated' });
      setFn?.({ count: 0 });
      await flushMicrotasks();

      expect(publishedUpdates).toHaveLength(0);
      expect(context.getFieldTimestampSnapshot()).toBeUndefined();

      setFn?.({ count: 1 });
      await flushMicrotasks();
      const timestampSnapshot = context.getFieldTimestampSnapshot();
      expect(timestampSnapshot?.count).toBeDefined();
      expect(publishedUpdates).toHaveLength(1);
      expect(publishedUpdates[0].values).toEqual({ count: 1 });
    });
  });

  describe('field configuration', () => {
    it('derives sync fields by excluding functions', () => {
      const baseCreator: StateCreator<{ count: number; name: string; increment: () => void }> = set => ({
        count: 0,
        name: 'demo',
        increment: () => set(s => ({ count: s.count + 1 })),
      });

      const config: NormalizedSyncConfig<{ count: number; name: string; increment: () => void }> = { key: 'derived-fields' };
      const { registration } = registerStore(config, baseCreator, { count: 0, name: 'demo', increment: () => {} });

      expect(registration.fields).toEqual(['count', 'name']);
    });

    it('respects explicit fields option', () => {
      const baseCreator: StateCreator<{ a: number; b: number; c: number }> = () => ({ a: 1, b: 2, c: 3 });
      const config: NormalizedSyncConfig<{ a: number; b: number; c: number }> = { key: 'explicit', fields: ['a', 'c'] };

      const { registration } = registerStore(config, baseCreator, { a: 1, b: 2, c: 3 });
      expect(registration.fields).toEqual(['a', 'c']);
    });
  });

  describe('subscription lifecycle', () => {
    it('tracks internal full-state cascade subscriptions', async () => {
      const onFirstSubscribe = vi.fn();
      const onLastUnsubscribe = vi.fn();
      const config: NormalizedSyncConfig<CounterState> = { key: 'cascade-subscription-lifecycle' };
      const { store } = registerStore(config, () => ({ count: 0 }), { count: 0 }, { handle: { onFirstSubscribe, onLastUnsubscribe } });

      const unsubscribe = store.api[SUBSCRIBE_CASCADE_STATE](() => undefined);

      expect(onFirstSubscribe).toHaveBeenCalledTimes(1);
      expect(onLastUnsubscribe).not.toHaveBeenCalled();

      unsubscribe();
      await flushMicrotasks();

      expect(onLastUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('remote update handling', () => {
    it('queues remote updates until hydration flush completes in async mode', async () => {
      const baseCreator: StateCreator<CounterState> = () => ({ count: 0 });
      const config: NormalizedSyncConfig<CounterState> = { key: 'queue-test' };
      const { registration, store, context } = registerStore(config, baseCreator, { count: 0 }, { isAsync: true });

      const apply = registration.apply;
      apply({ replace: false, sessionId: 'remote', timestamp: 1, values: { count: 5 } });

      expect(store.state.current.count).toBe(0);

      context.onHydrationComplete?.();
      await flushMicrotasks();
      expect(store.state.current.count).toBe(0);

      context.onHydrationFlushEnd?.();
      await flushMicrotasks();
      expect(store.state.current.count).toBe(5);
    });

    it('applies queued remote updates in arrival order after flush', async () => {
      const baseCreator: StateCreator<CounterState> = () => ({ count: 0 });
      const config: NormalizedSyncConfig<CounterState> = { key: 'queue-order' };
      const { registration, store, context } = registerStore(config, baseCreator, { count: 0 }, { isAsync: true });

      const appliedCounts: number[] = [];
      const originalSetState = store.api.setState;
      store.api.setState = (...args: SetStateArgs<CounterState>) => {
        const result = applySetState(originalSetState, args);
        appliedCounts.push(store.state.current.count);
        return result;
      };
      context.setWithoutPersist = store.api.setState;

      const apply = registration.apply;
      apply({ replace: false, sessionId: 'remote', timestamp: 10, values: { count: 1 } });
      apply({ replace: false, sessionId: 'remote', timestamp: 11, values: { count: 2 } });

      context.onHydrationComplete?.();
      context.onHydrationFlushEnd?.();
      await flushMicrotasks(2);

      expect(appliedCounts).toEqual([1, 2]);
      expect(store.state.current.count).toBe(2);
    });

    it('ignores stale remote updates based on timestamp and session id', async () => {
      let localSet: ((partial: Partial<CounterState>) => void) | undefined;
      const baseCreator: StateCreator<CounterState> = set => {
        localSet = set;
        return { count: 0 };
      };
      const config: NormalizedSyncConfig<CounterState> = { key: 'stale-filter' };
      const { registration, store, handle, context } = registerStore(config, baseCreator, { count: 0 });

      handle.triggerHydrated();
      localSet?.({ count: 2 });
      await flushMicrotasks();
      const localTimestamp = context.getFieldTimestampSnapshot()?.count ?? 0;

      const apply = registration.apply;
      apply({ replace: false, sessionId: 'remote-a', timestamp: localTimestamp - 1, values: { count: 3 } });
      expect(store.state.current.count).toBe(2);

      apply({ replace: false, sessionId: 'remote-b', timestamp: localTimestamp + 1, values: { count: 4 } });
      await flushMicrotasks();
      expect(store.state.current.count).toBe(4);

      apply({ replace: false, sessionId: 'remote-a', timestamp: localTimestamp + 1, values: { count: 6 } });
      expect(store.state.current.count).toBe(4);
    });

    it('applies merge functions when provided for specific fields', async () => {
      type State = { items: number[] };
      const baseCreator: StateCreator<State> = () => ({ items: [1, 2] });
      const config: NormalizedSyncConfig<State> = {
        key: 'merge-test',
        merge: {
          items: (incoming, current) => [...new Set([...current, ...incoming])],
        },
      };

      const { registration, store, handle } = registerStore(config, baseCreator, { items: [1, 2] });
      handle.triggerHydrated();

      const apply = registration.apply;
      apply({ replace: false, sessionId: 'remote', timestamp: 1, values: { items: [2, 3] } });
      await flushMicrotasks();

      expect(store.state.current.items).toEqual([1, 2, 3]);
    });

    it('applies replace updates when no keys are cleared', async () => {
      type State = { title: string; count: number };
      const baseCreator: StateCreator<State> = () => ({ title: 'Draft', count: 1 });
      const config: NormalizedSyncConfig<State> = { key: 'replace-no-clear' };

      const { registration, store, handle } = registerStore(config, baseCreator, { title: 'Draft', count: 1 });
      handle.triggerHydrated();

      const apply = registration.apply;
      apply({
        replace: true,
        sessionId: 'remote',
        timestamp: 10,
        values: { title: 'Published', count: 5 },
      });

      await flushMicrotasks();
      expect(store.state.current).toEqual({ title: 'Published', count: 5 });
    });

    it('removes stale keys on replace updates when not provided', async () => {
      type State = { present?: string; other?: string };
      const baseCreator: StateCreator<State> = () => ({ present: 'yes', other: 'keep' });
      const config: NormalizedSyncConfig<State> = { key: 'replace-test' };
      const { registration, store, handle } = registerStore(config, baseCreator, { present: 'yes', other: 'keep' });
      handle.triggerHydrated();

      const apply = registration.apply;
      apply({
        replace: true,
        sessionId: 'remote',
        timestamp: 10,
        values: { other: 'keep' },
      });

      await flushMicrotasks();
      expect(store.state.current).toEqual({ other: 'keep' });
    });
  });
});
