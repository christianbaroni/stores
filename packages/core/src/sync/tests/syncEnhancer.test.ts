/**
 * @jest-environment node
 */

import { SetStateArgs, StateCreator } from '../../types';
import { SyncContext, createSyncedStateCreator } from '../syncEnhancer';
import { NormalizedSyncConfig, SyncRegistration, SyncUpdate } from '../types';
import { MockStoreApi, capturePublishedUpdates, createMockEngine, createMockStore, flushMicrotasks, triggerOnHydrated } from './testUtils';

type CounterState = { count: number };

function registerStore<T extends Record<string, unknown>>(
  config: NormalizedSyncConfig<T>,
  stateCreator: StateCreator<T>,
  initialState: T,
  overrides: {
    isAsync?: boolean;
  } = {}
): {
  registration: SyncRegistration<T>;
  store: MockStoreApi<T>;
  publishLog: SyncUpdate<T>[];
  context: SyncContext;
  handle: ReturnType<typeof createMockEngine<T>>['handle'];
} {
  const { engine, handle, onRegister } = createMockEngine<T>();
  const middleware = createSyncedStateCreator(stateCreator, { ...config, engine }, overrides.isAsync ?? false);
  const store = createMockStore<T>(initialState);
  const resolvedState = middleware.stateCreator(store.api.setState, store.api.getState, store.api);
  store.state.current = resolvedState;

  if (middleware.syncContext.isAsync && !middleware.syncContext.setWithoutPersist) {
    middleware.syncContext.setWithoutPersist = store.api.setState;
  }

  const registration: SyncRegistration<T> = onRegister.mock.calls[0][0];
  const publishLog = capturePublishedUpdates(handle);

  return { registration, store, publishLog, context: middleware.syncContext, handle };
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
      const { publishLog, handle } = registerStore(config, baseCreator, { count: 0 });

      expect(enhancedSet).toBeDefined();
      enhancedSet?.({ count: 1 });

      await flushMicrotasks();
      expect(publishLog).toHaveLength(0);

      triggerOnHydrated(handle);
      await flushMicrotasks();

      expect(publishLog).toHaveLength(1);
      expect(publishLog[0].values).toEqual({ count: 1 });
    });

    it('records field timestamps for modified keys', () => {
      let setFn: ((partial: Partial<{ count: number; label: string }>) => void) | undefined;
      const baseCreator: StateCreator<{ count: number; label: string }> = set => {
        setFn = set;
        return { count: 0, label: 'initial' };
      };

      const config: NormalizedSyncConfig<{ count: number; label: string }> = { key: 'metadata-test' };
      const { context, handle } = registerStore(config, baseCreator, { count: 0, label: 'initial' });

      triggerOnHydrated(handle);
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
      const { publishLog, handle, context } = registerStore(config, baseCreator, { count: 0, note: 'start' });

      triggerOnHydrated(handle);
      setFn?.({ note: 'updated' });
      setFn?.({ count: 0 });
      await flushMicrotasks();

      expect(publishLog).toHaveLength(0);
      expect(context.getFieldTimestampSnapshot()).toBeUndefined();

      setFn?.({ count: 1 });
      await flushMicrotasks();
      const timestampSnapshot = context.getFieldTimestampSnapshot();
      expect(timestampSnapshot?.count).toBeDefined();
      expect(publishLog).toHaveLength(1);
      expect(publishLog[0].values).toEqual({ count: 1 });
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
        const result = args[1] ? originalSetState(args[0], args[1]) : originalSetState(args[0]);
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

      triggerOnHydrated(handle);
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
      triggerOnHydrated(handle);

      const apply = registration.apply;
      apply({ replace: false, sessionId: 'remote', timestamp: 1, values: { items: [2, 3] } });
      await flushMicrotasks();

      expect(store.state.current.items).toEqual([1, 2, 3]);
    });

    it('removes stale keys on replace updates when not provided', async () => {
      type State = { present?: string; other?: string };
      const baseCreator: StateCreator<State> = () => ({ present: 'yes', other: 'keep' });
      const config: NormalizedSyncConfig<State> = { key: 'replace-test' };
      const { registration, store, handle } = registerStore(config, baseCreator, { present: 'yes', other: 'keep' });
      triggerOnHydrated(handle);

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
