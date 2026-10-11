/**
 * @vitest-environment happy-dom
 */

import { act, createElement, useLayoutEffect } from 'react';
import { createBaseStore } from '../createBaseStore';
import { createMountedRoot } from '../react.testUtils';
import type { EqualityFn } from '../types';
import { useListen, type ListenHandle, type UseListenOptions } from './useListen';

describe('useListen', () => {
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

  it('shares the comparison value between refresh and store updates', () => {
    const store = createBaseStore(() => ({ a: 1, b: 2 }));
    const changes: [string, number, number][] = [];
    let listener: Readonly<ListenHandle>;

    function View({ field }: { field: 'a' | 'b' }) {
      const handle = useListen(
        store,
        state => state[field],
        (current, previous) => changes.push([field, current, previous])
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
      expect(changes).toEqual([['b', 2, 1]]);

      act(() => listener.refresh());
      expect(changes).toEqual([['b', 2, 1]]);

      act(() => store.setState({ b: 1 }));
      expect(changes).toEqual([
        ['b', 2, 1],
        ['b', 1, 2],
      ]);
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
