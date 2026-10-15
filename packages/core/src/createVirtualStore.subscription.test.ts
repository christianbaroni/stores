import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createPublicStore } from './createPublicStore.testUtils';
import { createDerivedStore } from './createDerivedStore';
import { createQueryStore } from './createQueryStore';
import { QueryStatuses } from './queryStore/types';
import { isCascadeActive } from './internal/cascadeScheduler';
import { createVirtualStore } from './createVirtualStore';
import { destroyStore } from './internal/storeUtils';
import type { InternalUnsubscribeFn } from './internal/internalSubscriptions';
import type { SyncEngine } from './sync/types';
import type { SubscribeArgs } from './types';
import { noop } from './utils/core';

afterEach(() => {
  vi.useRealTimers();
});

describe('virtual selector subscriptions', () => {
  it.each([0, 1])('evaluates the replacement once after sync activation (count=%i)', async count => {
    const choice = createBaseStore(() => false);
    const previous = createBaseStore(() => ({ count: 0 }));
    const register = vi.fn<SyncEngine['register']>(() => ({
      destroy: noop,
      publish: null,
      onFirstSubscribe() {
        register.mock.calls[0][0].apply({ replace: false, sessionId: 'remote', timestamp: 1, values: { count } });
      },
    }));
    const replacement = createBaseStore(() => ({ count: 0 }), {
      sync: { key: 'replacement', engine: { sessionId: 'local', register } },
    });
    const store = createVirtualStore($ => ($(choice) ? replacement : previous));

    const selector = vi.fn((state: { count: number }) => state.count);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(selector, listener);
    selector.mockClear();

    try {
      choice.setState(true);
      await flushMicrotasks();
      expect(selector).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls).toEqual(count ? [[count, 0]] : []);

      replacement.setState({ count: 2 });
      expect(listener).toHaveBeenLastCalledWith(2, count);
    } finally {
      unsubscribe();
      destroyStore(store);
      destroyStore(replacement);
    }
  });

  it('recovers on the next replacement after a public selector throws', () => {
    const key = createBaseStore(() => 0);
    const store = createVirtualStore($ => createPublicStore({ count: $(key) }));
    const listener = vi.fn();

    const unsubscribe = store.subscribe(state => {
      if (state.count === 1) throw new Error('selector failed');
      return state.count;
    }, listener);

    const unsubscribeKey = key.subscribe(noop);

    try {
      expect(() => key.setState(1)).toThrow('selector failed');
      expect(listener).not.toHaveBeenCalled();

      key.setState(2);
      expect(listener.mock.calls).toEqual([[2, 0]]);
    } finally {
      unsubscribe();
      unsubscribeKey();
      destroyStore(store);
    }
  });

  it('cleans up a public subscription if reading its initial selection fails', () => {
    const source = createPublicStore({ count: 0 });
    const subscribe = source.subscribe;
    const cleanups: ReturnType<typeof vi.fn>[] = [];

    source.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
      const unsubscribe = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
      const cleanup = vi.fn(unsubscribe);
      cleanups.push(cleanup);
      return cleanup;
    };

    const getState = source.getState;
    source.getState = () => {
      throw new Error('initial read failed');
    };

    const store = createVirtualStore(() => source);
    const listener = vi.fn();

    try {
      expect(() => store.subscribe(state => state.count, listener)).toThrow('initial read failed');
      expect(cleanups).toHaveLength(1);
      expect(cleanups[0]).toHaveBeenCalledTimes(1);

      source.getState = getState;
      const unsubscribe = store.subscribe(state => state.count, listener);
      source.setState({ count: 1 });
      expect(listener.mock.calls).toEqual([[1, 0]]);

      unsubscribe();
      expect(cleanups[1]).toHaveBeenCalledTimes(1);
    } finally {
      destroyStore(store);
    }
  });

  it.each(['base', 'derived'])('preserves native selection and comparison history through replacement (%s)', async kind => {
    const key = createBaseStore(() => ({ id: 1 }));
    let write: (count: number) => void = noop;
    let insideNativeSelector = false;

    const store = createVirtualStore($ => {
      const id = $(key).id;
      const source = createBaseStore(() => ({ count: id * 10 }));
      write = count => source.setState({ count });
      const backing = kind === 'base' ? source : createDerivedStore($ => $(source, state => state));
      const subscribe = backing.subscribe;
      backing.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
        if (args.length === 1) return subscribe(args[0]);
        return subscribe(
          state => {
            insideNativeSelector = true;

            try {
              return args[0](state);
            } finally {
              insideNativeSelector = false;
            }
          },
          args[1],
          args[2]
        );
      };
      return backing;
    });

    const changes: [number, number][] = [];
    const unsubscribe = store.subscribe(
      state => {
        expect(insideNativeSelector).toBe(true);
        return state.count;
      },
      (next, previous) => changes.push([next, previous]),
      { equalityFn: (a, b) => Math.floor(a / 10) === Math.floor(b / 10) }
    );

    try {
      write(11);
      await flushMicrotasks();
      expect(changes).toEqual([]);

      key.setState({ id: 2 });
      await flushMicrotasks();
      expect(changes).toEqual([[20, 10]]);

      write(21);
      await flushMicrotasks();
      expect(changes).toEqual([[20, 10]]);

      write(30);
      await flushMicrotasks();
      expect(changes).toEqual([
        [20, 10],
        [30, 20],
      ]);
    } finally {
      unsubscribe();
      destroyStore(store);
    }
  });

  it('carries comparison history between native and public-only backing stores', async () => {
    const source = createBaseStore(() => ({ id: 0 }));
    const store = createVirtualStore($ => {
      const id = $(source).id;
      return id % 2 ? createPublicStore({ count: id * 2 }) : createBaseStore(() => ({ count: id * 2 }));
    });

    const derived = createDerivedStore($ => $(store, state => state.count));
    const values: number[] = [];
    const changes: [number, number][] = [];

    const unsubscribeDerived = derived.subscribe(value => values.push(value));
    const unsubscribe = store.subscribe(
      state => state.count,
      (current, previous) => changes.push([current, previous]),
      { equalityFn: (previous, current) => Math.abs(previous - current) < 3 }
    );

    try {
      source.setState({ id: 1 });
      await flushMicrotasks();
      expect(changes).toEqual([]);
      expect(values).toEqual([2]);

      store.setState({ count: 4 });
      await flushMicrotasks();
      expect(changes).toEqual([[4, 0]]);
      expect(values).toEqual([2, 4]);

      source.setState({ id: 4 });
      await flushMicrotasks();
      expect(changes).toEqual([
        [4, 0],
        [8, 4],
      ]);
      expect(values).toEqual([2, 4, 8]);
    } finally {
      unsubscribe();
      unsubscribeDerived();
      destroyStore(store);
    }
  });

  it.each([
    ['native', false],
    ['native', true],
    ['public', false],
    ['public', true],
  ] as const)('preserves cancellation and its abort policy during attachment (%s, skip=%s)', async (kind, skipAbortFetch) => {
    const key = createBaseStore(() => ({ id: 1 }));
    const cleanup = vi.fn();
    const listener = vi.fn();
    let unsubscribe: InternalUnsubscribeFn = noop;

    const store = createVirtualStore($ => {
      const id = $(key).id;
      const backing = kind === 'native' ? createBaseStore(() => ({ count: id })) : createPublicStore({ count: id });
      const subscribe = backing.subscribe;
      backing.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
        const detach = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
        if (id === 2) unsubscribe(skipAbortFetch);
        return (skip?: boolean) => {
          cleanup(id, skip);
          detach();
        };
      };
      return backing;
    });

    unsubscribe = store.subscribe(state => state.count, listener);

    try {
      key.setState({ id: 2 });
      await flushMicrotasks();
      expect(cleanup.mock.calls).toEqual([
        [1, undefined],
        [2, skipAbortFetch],
      ]);

      store.setState({ count: 3 });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      destroyStore(store);
    }
  });
});

describe('virtual dependency continuity', () => {
  it('keeps a virtual link when a direct dependency on its backing store is removed', async () => {
    const source = createBaseStore(() => 1);
    const backing = createDerivedStore($ => $(source) * 10);
    const virtual = createVirtualStore(() => backing);
    const includeDirect = createBaseStore(() => true);
    const output = createDerivedStore($ => $(virtual) + ($(includeDirect) ? $(backing) : 0));
    const unsubscribe = output.subscribe(() => {});

    try {
      expect(output.getState()).toBe(20);

      includeDirect.setState(false);
      await flushMicrotasks();
      expect(output.getState()).toBe(10);

      source.setState(2);
      await flushMicrotasks();
      expect(output.getState()).toBe(20);
    } finally {
      unsubscribe();
      destroyStore(virtual);
      backing.destroy();
    }
  });
});

describe('virtual store pending rebinding', () => {
  it('allows an old backing write to flush away its last ordinary subscriber', () => {
    const choice = createBaseStore(() => false);
    const previous = createBaseStore(() => 1);
    const replacement = createBaseStore(() => 10);
    const virtual = createVirtualStore($ => ($(choice) ? replacement : previous));
    const values: number[] = [];
    const unsubscribe = virtual.subscribe(value => values.push(value));

    try {
      choice.setState(true);
      previous.setState(2);
      expect(values).toEqual([10]);
      expect(virtual.getState()).toBe(10);
    } finally {
      unsubscribe();
      destroyStore(virtual);
    }
  });
});

describe('virtual store rebinding', () => {
  it('settles the backing selection before a dependent getState returns', async () => {
    const choice = createBaseStore(() => false);
    const first = createBaseStore(() => 1);
    const second = createBaseStore(() => 10);
    const virtual = createVirtualStore($ => ($(choice) ? second : first));
    const output = createDerivedStore($ => $(virtual) * 2);
    const events: number[][] = [];
    const observations: number[] = [];
    const unsubscribe = output.subscribe((next, prev) => events.push([next, prev]));
    const unsubscribeVirtual = virtual.subscribe(() => observations.push(output.getState()));

    try {
      expect(output.getState()).toBe(2);

      choice.setState(true);
      expect(output.getState()).toBe(20);
      expect(observations).toEqual([]);

      second.setState(11);
      expect(output.getState()).toBe(22);

      await flushMicrotasks();
      expect(events).toEqual([[22, 2]]);
      expect(observations).toEqual([22]);
    } finally {
      unsubscribeVirtual();
      unsubscribe();
      destroyStore(virtual);
    }
  });

  it('publishes the loading state started by acquiring a native query subscription', async () => {
    const choice = createBaseStore(() => false);
    const previous = createQueryStore({ enabled: false, fetcher: () => new Promise<never>(() => {}), params: { id: 0 } });
    const replacement = createQueryStore({ fetcher: () => new Promise<never>(() => {}), params: { id: 1 } });
    const virtual = createVirtualStore($ => ($(choice) ? replacement : previous));
    const fullEvents: string[][] = [];
    const selectedEvents: string[][] = [];

    const unsubscribeState = virtual.subscribe((next, prev) => fullEvents.push([next.status, prev.status, virtual.getState().status]));
    const unsubscribeSelection = virtual.subscribe(
      state => state.status,
      (next, prev) => selectedEvents.push([next, prev]),
      { fireImmediately: true }
    );

    try {
      expect(selectedEvents).toEqual([[QueryStatuses.Idle, QueryStatuses.Idle]]);
      choice.setState(true);
      await flushMicrotasks();

      expect(fullEvents).toEqual([[QueryStatuses.Loading, QueryStatuses.Idle, QueryStatuses.Loading]]);
      expect(selectedEvents).toEqual([
        [QueryStatuses.Idle, QueryStatuses.Idle],
        [QueryStatuses.Loading, QueryStatuses.Idle],
      ]);
    } finally {
      unsubscribeState();
      unsubscribeSelection();
      destroyStore(virtual);
      destroyStore(replacement);
    }
  });

  it('invalidates a selected dependency for state changed by acquiring the replacement query', async () => {
    const choice = createBaseStore(() => false);
    const previous = createQueryStore({ enabled: false, fetcher: () => new Promise<never>(() => {}), params: { id: 0 } });
    const replacement = createQueryStore({ fetcher: () => new Promise<never>(() => {}), params: { id: 1 } });
    const virtual = createVirtualStore($ => ($(choice) ? replacement : previous));
    const status = createDerivedStore($ => $(virtual, state => state.status));
    const unsubscribe = status.subscribe(() => {});

    try {
      expect(status.getState()).toBe(QueryStatuses.Idle);
      choice.setState(true);
      await flushMicrotasks();
      expect(status.getState()).toBe(QueryStatuses.Loading);
      expect(virtual.getState().status).toBe(QueryStatuses.Loading);
    } finally {
      unsubscribe();
      destroyStore(virtual);
      destroyStore(replacement);
    }
  });

  it('settles an existing derived backing store before admitting ordinary listeners', async () => {
    const source = createBaseStore(() => 1);
    const replacement = createDerivedStore($ => $(source) * 10, { keepAlive: true });
    expect(replacement.getState()).toBe(10);

    const choice = createBaseStore(() => false);
    const previous = createBaseStore(() => 0);
    const virtual = createVirtualStore($ => ($(choice) ? replacement : previous));
    const events: number[][] = [];
    const unsubscribe = virtual.subscribe((next, prev) => events.push([next, prev]));

    try {
      choice.setState(true);
      source.setState(2);
      await flushMicrotasks();
      expect(events).toEqual([[20, 0]]);
      expect(virtual.getState()).toBe(20);
    } finally {
      unsubscribe();
      destroyStore(virtual);
      replacement.destroy();
    }
  });
});

describe('virtual selection ownership', () => {
  it('advances comparison history before middleware delivery across nested backing changes', async () => {
    const choice = createBaseStore(() => false);
    const first = createPublicStore({ count: 0 });
    const second = createBaseStore(() => ({ count: 2 }));
    const backing = createVirtualStore($ => ($(choice) ? second : first));
    const virtual = createVirtualStore(() => backing);
    const subscribe = virtual.subscribe;

    virtual.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
      if (args.length === 1) return subscribe(args[0]);
      return subscribe(
        args[0],
        (next, previous) => {
          if (next !== 1) args[1](Number(next) * 10, Number(previous) * 10);
        },
        args[2]
      );
    };

    const changes: [number, number][] = [];
    const unsubscribe = virtual.subscribe(
      state => state.count,
      (next, previous) => changes.push([next, previous])
    );

    try {
      first.setState({ count: 1 });
      expect(changes).toEqual([]);

      choice.setState(true);
      await flushMicrotasks();
      expect(changes).toEqual([[20, 10]]);

      second.setState({ count: 3 });
      expect(changes).toEqual([
        [20, 10],
        [30, 20],
      ]);
    } finally {
      unsubscribe();
      destroyStore(virtual);
      destroyStore(backing);
    }
  });

  it('does not start a cascade when a selected dependency is unchanged', async () => {
    const source = createBaseStore(() => ({ count: 0, unrelated: 0 }));
    const virtual = createVirtualStore(() => source);
    const derived = createDerivedStore($ => $(virtual, state => state.count));
    const unsubscribe = derived.subscribe(noop);

    try {
      await flushMicrotasks();
      source.setState({ unrelated: 1 });
      expect(isCascadeActive()).toBe(false);
    } finally {
      unsubscribe();
      destroyStore(virtual);
    }
  });
});

describe('raw virtual subscriptions', () => {
  it.each([false, true])('preserves native delivery independently of the replacement notification (debounced=%s)', async debounced => {
    vi.useFakeTimers();
    const key = createBaseStore(() => ({ id: 0 }));
    const source = createBaseStore(() => ({ value: 10 }));
    const replacement = createDerivedStore($ => $(source).value, debounced ? { debounce: 50 } : {});
    const backingEvents: [number, number][] = [];
    const unsubscribeBacking = replacement.subscribe((current, previous) => backingEvents.push([current, previous]));
    const original = createBaseStore(() => 0);
    const virtual = createVirtualStore($ => ($(key).id ? replacement : original));
    const events: [number, number][] = [];
    const unsubscribe = virtual.subscribe((current, previous) => events.push([current, previous]));

    try {
      source.setState({ value: 20 });
      key.setState({ id: 1 });
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(50);
      expect(virtual.getState()).toBe(20);
      expect(events).toEqual(
        debounced
          ? [
              [20, 0],
              [20, 10],
            ]
          : [[20, 0]]
      );
      expect(backingEvents).toEqual([[20, 10]]);
    } finally {
      unsubscribe();
      unsubscribeBacking();
      destroyStore(virtual);
    }
  });

  it.each(['initial', 'rebound', 'nested'] as const)('forwards native raw transactions unchanged (%s)', async mode => {
    const source = createBaseStore(() => 0);
    const choice = createBaseStore(() => false);
    const original = createBaseStore(() => 0);
    const backing = createVirtualStore($ => (mode === 'rebound' && !$(choice) ? original : source));
    const virtual = mode === 'nested' ? createVirtualStore(() => backing) : backing;
    const direct: [number, number][] = [];
    const events: [number, number][] = [];

    const unsubscribeWriter = source.subscribe(value => {
      if (value === 1) source.setState(2);
    });

    const unsubscribeDirect = source.subscribe((next, previous) => direct.push([next, previous]));
    const unsubscribeVirtual = virtual.subscribe((next, previous) => events.push([next, previous]));

    try {
      if (mode === 'rebound') {
        choice.setState(true);
        await flushMicrotasks();
      }
      source.setState(1);
      expect(direct).toEqual([
        [2, 1],
        [2, 0],
      ]);
      expect(events).toEqual(direct);
    } finally {
      unsubscribeVirtual();
      unsubscribeDirect();
      unsubscribeWriter();
      destroyStore(virtual);
      if (virtual !== backing) destroyStore(backing);
    }
  });

  it('preserves pending debounce work through raw unsubscribe and resubscribe', async () => {
    vi.useFakeTimers();
    const source = createBaseStore(() => 0);
    let deriveCount = 0;

    const backing = createDerivedStore(
      $ => {
        deriveCount += 1;
        return $(source);
      },
      { debounce: 50 }
    );

    const virtual = createVirtualStore(() => backing);
    const unsubscribeFirst = virtual.subscribe(() => undefined);
    let unsubscribeSecond: (() => void) | undefined;

    try {
      source.setState(1);
      unsubscribeFirst();
      const listener = vi.fn();
      unsubscribeSecond = virtual.subscribe(listener);
      expect(deriveCount).toBe(1);
      expect(listener).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(50);
      expect(deriveCount).toBe(2);
      expect(listener.mock.calls).toEqual([[1, 0]]);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond?.();
      destroyStore(virtual);
    }
  });

  it('preserves raw callback identity and native same-value notifications', async () => {
    const source = createBaseStore(() => 0);
    const backing = createDerivedStore(
      $ => {
        $(source);
        return 0;
      },
      { equalityFn: () => false }
    );

    const virtual = createVirtualStore(() => backing);
    const listener = vi.fn();
    const unsubscribeFirst = virtual.subscribe(listener);
    const unsubscribeSecond = virtual.subscribe(listener);

    try {
      source.setState(1);
      await flushMicrotasks();
      expect(listener.mock.calls).toEqual([[0, 0]]);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      destroyStore(virtual);
    }
  });
});
