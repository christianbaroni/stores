/**
 * @vitest-environment happy-dom
 */

import { act, createElement, memo } from 'react';
import type { ReactElement } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubscribeArgs, SubscribeOverloads, UnsubscribeFn } from '../types';
import { useSyncExternalStoreWithSelector } from './useSyncExternalStoreWithSelector';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type StoreListener<State> = (state: State, previous: State) => void;

type StoreMetrics = {
  notifications: number;
  subscribes: number;
  unsubscribes: number;
};

type TestStore<State> = {
  getServerSnapshot: () => State;
  getSnapshot: () => State;
  listenerCount: () => number;
  metrics: StoreMetrics;
  publish: (nextState: State) => void;
  replace: (nextState: State) => void;
  subscribe: SubscribeOverloads<State>;
};

type MountedRoot = {
  container: HTMLDivElement;
  render: (element: ReactElement) => void;
  unmount: () => void;
};

afterEach(() => {
  document.body.textContent = '';
});

describe('useSyncExternalStoreWithSelector', () => {
  it('computes selected updates once in the source notification and reuses the result during render', () => {
    type State = { count: number; revision: number };

    const store = createExternalStore<State>({ count: 0, revision: 0 });
    const renders: number[] = [];
    let selectorCalls = 0;

    const selectCount = (state: State): number => {
      selectorCalls += 1;
      return state.count;
    };

    function View(): null {
      const count = useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, store.getServerSnapshot, selectCount);

      renders.push(count);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      expect(renders).toEqual([0]);
      expect(selectorCalls).toBe(1);

      act(() => store.publish({ count: 0, revision: 1 }));
      expect(renders).toEqual([0]);
      expect(selectorCalls).toBe(2);

      act(() => store.publish({ count: 1, revision: 2 }));
      expect(renders).toEqual([0, 1]);
      expect(selectorCalls).toBe(3);
    } finally {
      root.unmount();
    }
  });

  it('preserves selected identity across inline selector churn when equality says the value is unchanged', () => {
    type State = { items: readonly string[] };

    const store = createExternalStore<State>({ items: ['A', 'B'] });
    const appSelections: (readonly string[])[] = [];
    const listSelections: (readonly string[])[] = [];

    const List = memo(function List({ items }: { items: readonly string[] }): null {
      listSelections.push(items);
      expect(items).toEqual(['A', 'B', 'C']);
      return null;
    });

    function App({ step: _step }: { step: number }): ReactElement {
      const items = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        state => [...state.items, 'C'],
        shallowEqualArray
      );

      appSelections.push(items);
      return createElement(List, { items });
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(App, { step: 0 }));
      root.render(createElement(App, { step: 1 }));

      expect(appSelections).toHaveLength(2);
      expect(listSelections).toHaveLength(1);
      expect(appSelections[1]).toBe(appSelections[0]);
    } finally {
      root.unmount();
    }
  });

  it('uses the current selector after selector identity changes even when the committed selector is unchanged', () => {
    type Field = 'left' | 'right';
    type State = Record<Field, number>;

    const store = createExternalStore<State>({ left: 0, right: 10 });
    const renders: number[] = [];

    function View({ field }: { field: Field }): null {
      const value = useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, store.getServerSnapshot, state => state[field]);

      renders.push(value);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { field: 'left' }));
      root.render(createElement(View, { field: 'right' }));

      act(() => store.publish({ left: 0, right: 11 }));

      expect(renders).toEqual([0, 10, 11]);
    } finally {
      root.unmount();
    }
  });

  it('does not let a stale committed selector force a render when the current selected value is equal', () => {
    type Field = 'left' | 'right';
    type Slot = { value: number };
    type State = Record<Field, Slot>;
    type Selection = { value: number };

    const store = createExternalStore<State>({ left: { value: 0 }, right: { value: 10 } });
    const renders: Selection[] = [];

    function View({ field }: { field: Field }): null {
      const selection = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        state => ({ value: state[field].value }),
        equalSelection
      );

      renders.push(selection);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { field: 'left' }));
      root.render(createElement(View, { field: 'right' }));

      act(() => store.publish({ left: { value: 1 }, right: { value: 10 } }));

      expect(renders.map(selection => selection.value)).toEqual([0, 10]);
    } finally {
      root.unmount();
    }
  });

  it('applies the current equality function without waiting for a resubscribe', () => {
    type State = { revision: number; value: number };
    type Selection = { value: number };

    const store = createExternalStore<State>({ revision: 0, value: 1 });
    const renders: Selection[] = [];

    function View({ useShallowEquality }: { useShallowEquality: boolean }): null {
      const equalityFn = useShallowEquality ? equalSelection : Object.is;
      const selection = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        state => ({ value: state.value }),
        equalityFn
      );

      renders.push(selection);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { useShallowEquality: false }));
      act(() => store.publish({ revision: 1, value: 1 }));
      root.render(createElement(View, { useShallowEquality: true }));
      act(() => store.publish({ revision: 2, value: 1 }));

      expect(renders.map(selection => selection.value)).toEqual([1, 1, 1]);
    } finally {
      root.unmount();
    }
  });

  it('uses default equality with the identity selector when no selector is provided', () => {
    type State = { revision: number; value: number };

    const store = createExternalStore<State>({ revision: 0, value: 1 });
    const renders: State[] = [];

    function View(): null {
      const state = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        undefined,
        undefined,
        equalStateValue
      );

      renders.push(state);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View));
      act(() => store.publish({ revision: 1, value: 1 }));
      act(() => store.publish({ revision: 2, value: 2 }));

      expect(renders.map(state => state.value)).toEqual([1, 2]);
    } finally {
      root.unmount();
    }
  });

  it('rebinds exactly once when the source subscribe identity changes', () => {
    type State = { value: string };

    const firstStore = createExternalStore<State>({ value: 'first:0' });
    const secondStore = createExternalStore<State>({ value: 'second:0' });
    const renders: string[] = [];

    function View({ store }: { store: TestStore<State> }): null {
      const value = useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, store.getServerSnapshot, state => state.value);

      renders.push(value);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { store: firstStore }));
      expect(firstStore.listenerCount()).toBe(1);
      expect(secondStore.listenerCount()).toBe(0);

      root.render(createElement(View, { store: secondStore }));
      expect(firstStore.listenerCount()).toBe(0);
      expect(secondStore.listenerCount()).toBe(1);

      act(() => firstStore.publish({ value: 'first:1' }));
      act(() => secondStore.publish({ value: 'second:1' }));

      expect(renders).toEqual(['first:0', 'second:0', 'second:1']);
      expect(firstStore.metrics.subscribes).toBe(1);
      expect(firstStore.metrics.unsubscribes).toBe(1);
      expect(secondStore.metrics.subscribes).toBe(1);
    } finally {
      root.unmount();
    }

    expect(secondStore.metrics.unsubscribes).toBe(1);
  });

  it('invalidates the cached source snapshot when the getSnapshot identity changes', () => {
    type State = { value: number };

    const store = createExternalStore<State>({ value: 0 });
    const renders: number[] = [];

    function View({ version }: { version: number }): null {
      const getSnapshot = version === 0 ? store.getSnapshot : () => store.getSnapshot();
      const value = useSyncExternalStoreWithSelector(store.subscribe, getSnapshot, store.getServerSnapshot, state => state.value);

      renders.push(value);
      return null;
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(View, { version: 0 }));
      store.replace({ value: 1 });
      root.render(createElement(View, { version: 1 }));

      expect(renders).toEqual([0, 1]);
      expect(store.metrics.subscribes).toBe(1);
    } finally {
      root.unmount();
    }
  });

  it('caches selected server snapshots during hydration', () => {
    type State = { label: string };

    const store = createExternalStore<State>({ label: 'ready' });

    function View(): ReactElement {
      const selection = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        state => ({ label: state.label }),
        equalLabel
      );

      return createElement('span', null, selection.label);
    }

    const html = renderToString(createElement(View));
    const container = document.createElement('div');
    const messages: string[] = [];
    let root: Root | null = null;

    container.innerHTML = html;
    document.body.appendChild(container);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(message => {
      messages.push(String(message));
    });

    try {
      act(() => {
        root = hydrateRoot(container, createElement(View));
      });

      expect(messages.filter(message => message.includes('getServerSnapshot should be cached'))).toEqual([]);
    } finally {
      consoleError.mockRestore();
      if (root !== null) {
        const hydratedRoot = root;
        act(() => hydratedRoot.unmount());
      }
      container.remove();
    }
  });
});

function createMountedRoot(): MountedRoot {
  const container = document.createElement('div');
  const root = createRoot(container);

  document.body.appendChild(container);

  return {
    container,
    render: element => {
      act(() => root.render(element));
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function createExternalStore<State>(initialState: State): TestStore<State> {
  let state = initialState;
  const listeners = new Set<StoreListener<State>>();
  const metrics: StoreMetrics = {
    notifications: 0,
    subscribes: 0,
    unsubscribes: 0,
  };

  const subscribe: SubscribeOverloads<State> = <Selected>(...args: SubscribeArgs<State, Selected>): UnsubscribeFn => {
    metrics.subscribes += 1;

    const listener = createStoreListener(args, () => state);
    listeners.add(listener);

    return () => {
      metrics.unsubscribes += 1;
      listeners.delete(listener);
    };
  };

  return {
    getServerSnapshot: () => state,
    getSnapshot: () => state,
    listenerCount: () => listeners.size,
    metrics,
    publish: nextState => {
      const previous = state;
      state = nextState;

      for (const listener of listeners) {
        metrics.notifications += 1;
        listener(state, previous);
      }
    },
    replace: nextState => {
      state = nextState;
    },
    subscribe,
  };
}

function createStoreListener<State, Selected>(args: SubscribeArgs<State, Selected>, getState: () => State): StoreListener<State> {
  if (args.length === 1) return args[0];

  const selector = args[0];
  const listener = args[1];
  const equalityFn = args[2]?.equalityFn ?? Object.is;
  let selected = selector(getState());

  return nextState => {
    const nextSelected = selector(nextState);
    if (equalityFn(selected, nextSelected)) return;

    const previousSelected = selected;
    selected = nextSelected;
    listener(nextSelected, previousSelected);
  };
}

function shallowEqualArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    if (!Object.is(a[index], b[index])) return false;
  }

  return true;
}

function equalSelection(a: { value: number }, b: { value: number }): boolean {
  return Object.is(a.value, b.value);
}

function equalStateValue(a: { value: number }, b: { value: number }): boolean {
  return Object.is(a.value, b.value);
}

function equalLabel(a: { label: string }, b: { label: string }): boolean {
  return Object.is(a.label, b.label);
}
