import { createBaseStore } from '../createBaseStore';
import { createDerivedStore } from '../createDerivedStore';
import { createPublicStore } from '../createPublicStore.testUtils';
import { createVirtualStore } from '../createVirtualStore';
import type { SubscribeArgs } from '../types';
import { createSelection, notifyInitial, subscribeSelection } from './selectorSubscription';
import { destroyStore } from './storeUtils';

describe('selection initialization', () => {
  it.each(['native', 'public'] as const)('preserves undefined and symbol selections through initialization and updates (%s)', kind => {
    const store = kind === 'native' ? createBaseStore<unknown>(() => undefined) : createPublicStore<unknown>(undefined);
    const listener = vi.fn();
    const selection = createSelection<unknown>(listener);
    const unsubscribe = subscribeSelection(store, state => state, { selection }, true);

    try {
      selection.refresh();
      expect(selection.currentSlice).toBeUndefined();

      notifyInitial(selection);

      const first = Symbol('first');
      const second = Symbol('second');
      store.setState(first, true);
      store.setState(second, true);
      store.setState(undefined, true);
      selection.refresh();
      selection.refresh();
      expect(selection.currentSlice).toBeUndefined();
      expect(listener.mock.calls).toEqual([
        [undefined, undefined],
        [first, undefined],
        [second, first],
        [undefined, second],
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('retains a newer selection when an outer selector returns an equal value', () => {
    const store = createBaseStore(() => 1);
    const subscribe = store.subscribe;
    store.subscribe = (...args: SubscribeArgs<number>) => {
      if (args.length === 1) return subscribe(args[0]);
      return subscribe(
        state => {
          const current = args[0](state);
          if (state === 1) store.setState(2);
          return current;
        },
        args[1],
        args[2]
      );
    };
    const listener = vi.fn();
    const selection = createSelection<number>(listener, { equalityFn: (a, b) => Math.floor(a / 10) === Math.floor(b / 10) });
    const unsubscribe = subscribeSelection(store, state => state, { selection }, true);

    try {
      selection.refresh();
      expect(selection.currentSlice).toBe(2);

      store.setState(11);
      expect(listener.mock.calls).toEqual([[11, 2]]);
    } finally {
      unsubscribe();
    }
  });

  it('establishes the final initial value through nested virtual subscriptions', () => {
    const source = createBaseStore(() => ({ count: 0 }));
    const subscribe = source.subscribe;
    source.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
      source.setState({ count: 1 });
      const unsubscribe = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
      source.setState({ count: 2 });
      return unsubscribe;
    };

    const inner = createVirtualStore(() => source);
    const outer = createVirtualStore(() => inner);
    const listener = vi.fn();
    const selection = createSelection<number>(listener, { equalityFn: (a, b) => Math.sign(a) === Math.sign(b) });
    const unsubscribe = subscribeSelection(outer, state => state.count, { selection }, true);

    try {
      expect(listener).not.toHaveBeenCalled();

      selection.refresh();
      expect(selection.currentSlice).toBe(2);

      source.setState({ count: 0 });
      expect(listener.mock.calls).toEqual([[0, 2]]);
    } finally {
      unsubscribe();
      destroyStore(outer);
      destroyStore(inner);
    }
  });

  it.each(['base', 'derived'] as const)('initializes a quiet native selection only once (%s)', kind => {
    const source = createBaseStore(() => ({ count: 3 }));
    const store = kind === 'base' ? source : createDerivedStore($ => $(source));
    const selector = vi.fn((state: { count: number }) => state.count);
    const listener = vi.fn();
    const selection = createSelection<number>(listener);
    const unsubscribe = subscribeSelection(store, selector, { selection }, true);

    try {
      selection.refresh();
      expect(selection.currentSlice).toBe(3);
      expect(selector).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('begins accepting reactions only when quiet attachment completes', () => {
    const store = createBaseStore(() => ({ count: 1 }));
    const subscribe = store.subscribe;
    store.subscribe = (...args: SubscribeArgs<{ count: number }>) => {
      if (args.length === 1) return subscribe(args[0]);
      const unsubscribe = subscribe(args[0], args[1], args[2]);
      const selected = args[0](store.getState());
      args[1](selected, selected);
      return unsubscribe;
    };
    const listener = vi.fn();
    const selection = createSelection<number>(listener);
    const unsubscribe = subscribeSelection(store, (state: { count: number }) => state.count, { selection }, true);

    try {
      selection.refresh();
      expect(listener).not.toHaveBeenCalled();

      store.setState({ count: 2 });
      expect(listener.mock.calls).toEqual([[2, 1]]);
    } finally {
      unsubscribe();
    }
  });
});
