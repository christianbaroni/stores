/**
 * @vitest-environment happy-dom
 */

import { act, createElement, useLayoutEffect } from 'react';
import { flushMicrotasks } from '../async.testUtils';
import { createBaseStore } from '../createBaseStore';
import { createPublicStore } from '../createPublicStore.testUtils';
import { createDerivedStore } from '../createDerivedStore';
import { createVirtualStore } from '../createVirtualStore';
import { destroyStore } from '../internal/storeUtils';
import { createMountedRoot } from '../react.testUtils';
import type { EqualityFn, SubscribeArgs } from '../types';
import { useListen, type ListenHandle, type UseListenOptions } from './useListen';

describe('useListen', () => {
  it.each([
    ['native', false],
    ['native', true],
    ['public', false],
    ['public', true],
  ] as const)('establishes its baseline after subscription setup (%s, fireImmediately=%s)', (kind, fireImmediately) => {
    const store = kind === 'native' ? createBaseStore(() => ({ count: 0 })) : createPublicStore({ count: 0 });
    const subscribe = store.subscribe;
    store.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
      store.setState({ count: 1 });
      const unsubscribe = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
      store.setState({ count: 2 });
      return unsubscribe;
    };
    const changes: [number, number][] = [];

    function View() {
      useListen(
        store,
        state => state.count,
        (current, previous) => changes.push([current, previous]),
        { fireImmediately, equalityFn: (previous, next) => Math.sign(previous) === Math.sign(next) }
      );
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      expect(changes).toEqual(fireImmediately ? [[2, 2]] : []);

      act(() => store.setState({ count: 0 }));
      expect(changes).toEqual(
        fireImmediately
          ? [
              [2, 2],
              [0, 2],
            ]
          : [[0, 2]]
      );
    } finally {
      root.unmount();
    }
  });

  it('refreshes through the attached provider and preserves history across its replacement', async () => {
    function source(count: number, multiplier: number) {
      const store = createBaseStore(() => ({ count }));
      const subscribe = store.subscribe;
      store.subscribe = (...args: SubscribeArgs<{ count: number }>) =>
        args.length === 1 ? subscribe(args[0]) : subscribe(state => args[0]({ count: state.count * multiplier }), args[1], args[2]);
      return store;
    }

    const choice = createBaseStore(() => false);
    const first = source(1, 10);
    const second = source(2, 100);
    const store = createVirtualStore($ => ($(choice) ? second : first));
    const changes: [number, number][] = [];
    let handle: Readonly<ListenHandle> | undefined;

    function View({ offset = 0 }: { offset?: number }) {
      const ref = useListen(
        store,
        state => state.count + offset,
        (current, previous) => changes.push([current, previous])
      );
      useLayoutEffect(() => {
        handle = ref.current;
      }, [ref]);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      act(() => choice.setState(true));
      root.render(createElement(View, { offset: 1 }));
      act(() => handle?.refresh());
      expect(changes).toEqual([[11, 10]]);

      await act(async () => flushMicrotasks());
      expect(changes).toEqual([
        [11, 10],
        [201, 11],
      ]);
      act(() => second.setState({ count: 3 }));
      expect(changes).toEqual([
        [11, 10],
        [201, 11],
        [301, 201],
      ]);
    } finally {
      root.unmount();
      destroyStore(store);
    }
  });

  it('preserves comparison history and cleanup through refresh using only the public store contract', () => {
    const store = createPublicStore({ a: 0, b: 2 });
    const subscribe = store.subscribe;
    const cleanup = vi.fn();
    store.subscribe = (...args: SubscribeArgs<{ a: number; b: number }>) => {
      const unsubscribe = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
      return () => {
        cleanup();
        unsubscribe();
      };
    };
    const changes: [number, number][] = [];
    let handle: Readonly<ListenHandle>;

    function View({ field }: { field: 'a' | 'b' }) {
      const listenHandle = useListen(
        store,
        state => state[field],
        (current, previous, _get, unsubscribe) => {
          changes.push([current, previous]);
          unsubscribe();
        },
        { equalityFn: (previous, current) => Math.abs(previous - current) < 3 }
      );
      useLayoutEffect(() => {
        handle = listenHandle.current;
      }, [listenHandle]);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { field: 'a' }));
      expect(cleanup).not.toHaveBeenCalled();

      root.render(createElement(View, { field: 'b' }));
      act(() => handle.refresh());
      expect(changes).toEqual([]);
      expect(cleanup).toHaveBeenCalledTimes(0);

      act(() => store.setState({ b: 4 }));
      expect(changes).toEqual([[4, 0]]);
      act(() => expect(handle.isActive).toBe(false));
      expect(cleanup).toHaveBeenCalledTimes(1);

      act(() => store.setState({ b: 8 }));
      expect(changes).toEqual([[4, 0]]);
    } finally {
      root.unmount();
    }
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves a public subscription when refreshing its selector throws', () => {
    const store = createPublicStore({ count: 0 });
    const changes: number[] = [];
    let handle: Readonly<ListenHandle>;

    function View({ fail = false }: { fail?: boolean }) {
      const listenHandle = useListen(
        store,
        state => {
          if (fail) throw new Error('Selection failed');
          return state.count;
        },
        current => changes.push(current)
      );
      useLayoutEffect(() => {
        handle = listenHandle.current;
      }, [listenHandle]);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      root.render(createElement(View, { fail: true }));
      expect(() => handle.refresh()).toThrow('Selection failed');
      root.render(createElement(View, { fail: false }));
      act(() => store.setState({ count: 1 }));
      expect(changes).toEqual([1]);
    } finally {
      root.unmount();
    }
    store.setState({ count: 2 });
    expect(changes).toEqual([1]);
  });

  it('provides the current store getter and lets reactions unsubscribe', () => {
    const store = createBaseStore(() => ({ count: 0, label: 'initial' }));
    const reaction = vi.fn((current: number, previous: number, get: typeof store.getState, unsubscribe: () => void) => {
      expect(get).toBe(store.getState);
      expect(get()).toEqual({ count: current, label: 'updated' });
      expect(previous).toBe(0);
      unsubscribe();
    });

    function View(): null {
      useListen(store, state => state.count, reaction);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      act(() => store.setState({ label: 'updated' }));
      expect(reaction).not.toHaveBeenCalled();

      act(() => store.setState({ count: 1 }));
      expect(reaction).toHaveBeenCalledTimes(1);

      act(() => store.setState({ count: 2 }));
      expect(reaction).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
    }
  });

  it.each(['base', 'derived'])('shares native selection and comparison between refresh and store updates (%s)', async kind => {
    const source = createBaseStore(() => ({ a: 11, b: 20 }));
    const store = kind === 'base' ? source : createDerivedStore($ => $(source, state => state));
    const subscribe = store.subscribe;
    let selecting = false;
    let subscriptions = 0;

    store.subscribe = (...args: SubscribeArgs<{ a: number; b: number }>) => {
      if (args.length === 1) return subscribe(args[0]);
      const [selector, listener, options] = args;
      subscriptions += 1;

      return subscribe(
        state => {
          selecting = true;

          try {
            return selector(state);
          } finally {
            selecting = false;
          }
        },
        listener,
        options
      );
    };

    const changes: [string, number, number][] = [];
    let listener: Readonly<ListenHandle>;

    function View({ field }: { field: 'a' | 'b' }) {
      const handle = useListen(
        store,
        state => {
          expect(selecting).toBe(true);
          return state[field];
        },
        (current, previous) => changes.push([field, current, previous]),
        { equalityFn: (a, b) => Math.floor(a / 10) === Math.floor(b / 10) }
      );

      useLayoutEffect(() => {
        listener = handle.current;
      }, [handle]);

      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { field: 'a' }));
      expect(changes).toEqual([]);

      root.render(createElement(View, { field: 'b' }));
      expect(changes).toEqual([]);

      act(() => listener.refresh());
      expect(changes).toEqual([['b', 20, 11]]);

      act(() => listener.refresh());
      expect(changes).toEqual([['b', 20, 11]]);

      await act(async () => {
        source.setState({ b: 21 });
        await flushMicrotasks();
      });
      expect(changes).toEqual([['b', 20, 11]]);

      await act(async () => {
        source.setState({ b: 11 });
        await flushMicrotasks();
      });
      expect(changes).toEqual([
        ['b', 20, 11],
        ['b', 11, 20],
      ]);
      expect(subscriptions).toBe(1);
    } finally {
      root.unmount();
    }
  });

  it('applies custom equality to refresh and store updates', () => {
    const store = createBaseStore(() => ({ a: 1, b: 1 }));
    const changes: [number, number][] = [];
    let listener: Readonly<ListenHandle>;

    function View({ field }: { field: 'a' | 'b' }) {
      const handle = useListen(
        store,
        state => ({ value: state[field] }),
        (current, previous) => changes.push([current.value, previous.value]),
        (previous, next) => previous.value === next.value
      );

      useLayoutEffect(() => {
        listener = handle.current;
      }, [handle]);

      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { field: 'a' }));

      act(() => listener.refresh());
      act(() => store.setState({ b: 3 }));
      expect(changes).toEqual([]);

      act(() => store.setState({ a: 2 }));
      expect(changes).toEqual([[2, 1]]);

      root.render(createElement(View, { field: 'b' }));
      act(() => listener.refresh());
      act(() => listener.refresh());
      expect(changes).toEqual([
        [2, 1],
        [3, 2],
      ]);
    } finally {
      root.unmount();
    }
  });

  it('replaces options without mutating the previous options', () => {
    const store = createBaseStore(() => ({ count: 0 }));
    const changes: [number, number][] = [];
    const options = Object.freeze({ fireImmediately: true });
    let listener: Readonly<ListenHandle>;

    function View({ options }: { options?: UseListenOptions<number> | EqualityFn<number> }) {
      const handle = useListen(
        store,
        state => state.count,
        (current, previous) => changes.push([current, previous]),
        options
      );

      useLayoutEffect(() => {
        listener = handle.current;
      }, [handle]);

      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      root.render(createElement(View, { options: Object.is }));
      expect(changes).toEqual([]);

      root.render(createElement(View, { options }));
      act(() => listener.resubscribe({ forceResubscribe: true }));
      expect(changes).toEqual([[0, 0]]);

      root.render(createElement(View, { options: Object.is }));
      act(() => listener.resubscribe({ forceResubscribe: true }));
      expect(changes).toEqual([[0, 0]]);

      act(() => store.setState({ count: 1 }));
      expect(changes).toEqual([
        [0, 0],
        [1, 0],
      ]);
    } finally {
      root.unmount();
    }
  });

  it('resumes from the current state and stays silent while detached', () => {
    const store = createBaseStore(() => ({ count: 0 }));
    const changes: [number, number][] = [];
    let listener: Readonly<ListenHandle>;

    function View() {
      const handle = useListen(
        store,
        state => state.count,
        (current, previous) => changes.push([current, previous])
      );

      useLayoutEffect(() => {
        listener = handle.current;
      }, [handle]);

      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));

      act(() => listener.unsubscribe());
      act(() => store.setState({ count: 1 }));
      act(() => listener.refresh());
      expect(changes).toEqual([]);

      act(() => listener.resubscribe({ fireImmediately: true }));
      expect(changes).toEqual([[1, 1]]);

      act(() => store.setState({ count: 2 }));
      expect(changes).toEqual([
        [1, 1],
        [2, 1],
      ]);
    } finally {
      root.unmount();
    }

    act(() => store.setState({ count: 3 }));
    act(() => listener.refresh());
    expect(changes).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('lets an immediate reaction unsubscribe', () => {
    const store = createBaseStore(() => ({ count: 0 }));
    const changes: [number, number][] = [];
    let listener: Readonly<ListenHandle>;

    function View() {
      const handle = useListen(
        store,
        state => state.count,
        (current, previous, _get, unsubscribe) => {
          changes.push([current, previous]);
          unsubscribe();
        },
        { fireImmediately: true }
      );

      useLayoutEffect(() => {
        listener = handle.current;
      }, [handle]);

      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      expect(changes).toEqual([[0, 0]]);

      act(() => store.setState({ count: 1 }));
      act(() => listener.refresh());
      expect(changes).toEqual([[0, 0]]);
    } finally {
      root.unmount();
    }
  });
});
