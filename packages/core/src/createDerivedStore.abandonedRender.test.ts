/**
 * @vitest-environment happy-dom
 */

import { act, createElement, Suspense, useLayoutEffect, useMemo } from 'react';
import { flushMacrotask } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';
import { derivedStore } from './internal/derivedStore';
import { createMountedRoot } from './react.testUtils';
import type { SubscribeArgs } from './types';

function createTrackedSource() {
  const source = createBaseStore(() => ({ value: 1 }));
  const subscribe = source.subscribe;
  const subscriptions = new Set<() => void>();
  const subscribeSpy = vi.spyOn(source, 'subscribe').mockImplementation((...args: SubscribeArgs<{ value: number }>) => {
    const unsubscribe = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
    const cleanup = () => {
      subscriptions.delete(cleanup);
      unsubscribe();
    };
    subscriptions.add(cleanup);
    return cleanup;
  });

  return { source, subscriptions, subscribeSpy };
}

describe('derived store subscriptions from uncommitted snapshot reads', () => {
  it('releases dependencies when a useMemo store suspends and its render is discarded', async () => {
    const { source, subscriptions, subscribeSpy } = createTrackedSource();
    const root = createMountedRoot();
    const commit = vi.fn();
    const snapshots: number[] = [];
    const pending = new Promise<never>(() => {});

    function Component(): never {
      const useDerived = useMemo(() => createDerivedStore($ => ({ value: $(source).value * 2 })), []);
      snapshots.push(useDerived().value); // The hook calls the internal getSnapshot before subscribing.
      useLayoutEffect(commit, []);
      throw pending;
    }

    try {
      root.render(createElement(Suspense, { fallback: 'pending' }, createElement(Component)));
      expect(root.container.textContent).toBe('pending');
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots.every(value => value === 2)).toBe(true);
      expect(subscribeSpy).toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();

      root.render(createElement('span', null, 'discarded'));
      await act(flushMacrotask);

      expect(commit).not.toHaveBeenCalled();
      expect(subscriptions.size).toBe(0);
    } finally {
      root.unmount();
      for (const unsubscribe of subscriptions) unsubscribe();
      subscribeSpy.mockRestore();
    }
  });

  it('releases dependencies after a snapshot read with no React component or subscriber', async () => {
    const { source, subscriptions, subscribeSpy } = createTrackedSource();
    const derived = derivedStore($ => ({ value: $(source).value * 2 }));

    try {
      const snapshot = derived.getSnapshot();
      expect(snapshot).toEqual({ value: 2 });
      expect(derived.getSnapshot()).toBe(snapshot);
      expect(subscriptions.size).toBe(1);

      await flushMacrotask();

      expect(subscriptions.size).toBe(0);
    } finally {
      derived.destroy();
      subscribeSpy.mockRestore();
    }
  });

  it.each(['proxy', 'selector'] as const)('releases upstream dependencies when a %s derivation throws before adoption', async mode => {
    const { source, subscriptions, subscribeSpy } = createTrackedSource();
    const error = new Error('abandoned derivation');
    const upstream = derivedStore($ => {
      const value = $(source, state => state.value);
      if (mode === 'selector') throw error;
      return { value };
    });
    const parent = derivedStore($ => {
      if (mode === 'selector') return $(upstream, state => state.value);
      $(upstream);
      throw error;
    });

    try {
      expect(() => parent.getSnapshot()).toThrow(error);
      expect(subscriptions.size).toBe(1);

      await flushMacrotask();

      expect(subscriptions.size).toBe(0);
    } finally {
      parent.destroy();
      upstream.destroy();
      subscribeSpy.mockRestore();
    }
  });

  it('keeps a committed useMemo store live and releases it on unmount', async () => {
    const { source, subscriptions, subscribeSpy } = createTrackedSource();
    const root = createMountedRoot();

    function Component() {
      const useDerived = useMemo(() => createDerivedStore($ => ({ value: $(source).value * 2 })), []);
      return createElement('span', null, useDerived().value);
    }

    try {
      root.render(createElement(Component));
      await act(flushMacrotask);

      expect(root.container.textContent).toBe('2');
      expect(subscriptions.size).toBe(1);

      act(() => source.setState({ value: 2 }));
      await act(flushMacrotask);

      expect(root.container.textContent).toBe('4');
      expect(subscriptions.size).toBe(1);
    } finally {
      root.unmount();
      subscribeSpy.mockRestore();
    }

    await flushMacrotask();
    expect(subscriptions.size).toBe(0);
  });
});
