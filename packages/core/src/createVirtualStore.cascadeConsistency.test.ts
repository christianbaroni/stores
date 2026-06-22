/**
 * @vitest-environment happy-dom
 */

import { act, createElement, memo, useLayoutEffect } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';
import { createVirtualStore } from './createVirtualStore';
import { flushMicrotasks } from './async.testUtils';
import { createMountedRoot } from './react.testUtils';

describe('createVirtualStore cascade consistency', () => {
  it('rebinds subscriptions before a source listener observes virtual state', () => {
    const baseStore = createBaseStore(() => ({ value: 'a' }));
    const virtualStore = createVirtualStore($ => {
      const value = $(baseStore).value;
      return createBaseStore(() => ({ value }));
    });
    const events: string[] = [];

    virtualStore.subscribe(
      state => state.value,
      (next, prev) => {
        events.push(`virtual:${prev}->${next}:base=${baseStore.getState().value}`);
      }
    );
    baseStore.subscribe(state => {
      events.push(`base:${state.value}:virtual=${virtualStore.getState().value}`);
    });

    expect(virtualStore.getState().value).toBe('a');

    baseStore.setState({ value: 'b' });

    expect(events).toEqual(['virtual:a->b:base=b', 'base:b:virtual=b']);
  });

  it('publishes virtual state only after getState reflects the new backing store', () => {
    const baseStore = createBaseStore(() => ({ value: 'a' }));
    const virtualStore = createVirtualStore($ => {
      const value = $(baseStore).value;
      return createBaseStore(() => ({ value }));
    });
    const events: string[] = [];

    virtualStore.subscribe(state => {
      events.push(`listener:${state.value}:read=${virtualStore.getState().value}`);
    });
    baseStore.subscribe(() => undefined);

    expect(virtualStore.getState().value).toBe('a');

    baseStore.setState({ value: 'b' });

    expect(events).toEqual(['listener:b:read=b']);
  });

  it('rebinds cascade participants before ordinary virtual listeners observe downstream state', async () => {
    const baseStore = createBaseStore(() => ({ value: 'a' }));
    const virtualStore = createVirtualStore($ => {
      const value = $(baseStore).value;
      return createBaseStore(() => ({ value }));
    });
    const downstreamStore = createDerivedStore($ => `${$(virtualStore, state => state.value)}!`);
    const observations: string[] = [];
    const events: string[] = [];

    const unsubscribeVirtual = virtualStore.subscribe(state => {
      observations.push(`virtual:${state.value}:downstream=${downstreamStore.getState()}`);
    });
    const unsubscribeDownstream = downstreamStore.subscribe((next, prev) => {
      events.push(`${prev}->${next}`);
    });

    try {
      expect(downstreamStore.getState()).toBe('a!');

      baseStore.setState({ value: 'b' });

      await flushMicrotasks();

      expect(observations).toEqual(['virtual:b:downstream=b!']);
      expect(events).toEqual(['a!->b!']);
      expect(downstreamStore.getState()).toBe('b!');
    } finally {
      unsubscribeDownstream();
      unsubscribeVirtual();
    }
  });

  it('keeps a base parent and virtual child consistent when the child renders with the parent update', async () => {
    const baseStore = createBaseStore(() => ({ value: 'a' }));
    const virtualStore = createVirtualStore($ => {
      const value = $(baseStore).value;
      return createBaseStore(() => ({ value }));
    });

    function Child(): ReactElement {
      const value = virtualStore(state => state.value);
      return createElement('span', { 'data-testid': 'child' }, value);
    }

    function Parent(): ReactElement {
      const value = baseStore(state => state.value);
      return createElement('div', null, createElement('span', { 'data-testid': 'parent' }, value), createElement(Child));
    }

    const root = createMountedRoot();

    try {
      root.render(createElement(Parent));
      expect(readText(root.container)).toEqual({ child: 'a', parent: 'a' });

      act(() => {
        baseStore.setState({ value: 'b' });
      });

      expect(readText(root.container)).toEqual({ child: 'b', parent: 'b' });

      await act(flushMicrotasks);

      expect(readText(root.container)).toEqual({ child: 'b', parent: 'b' });
    } finally {
      root.unmount();
    }
  });

  it('keeps a base parent and memoized virtual child consistent across a base update', async () => {
    const baseStore = createBaseStore(() => ({ value: 'a' }));
    const virtualStore = createVirtualStore($ => {
      const value = $(baseStore).value;
      return createBaseStore(() => ({ value }));
    });
    const root = createMountedRoot();
    const committedValues: { child: string | null; parent: string | null }[] = [];

    function recordCommittedValues(): void {
      committedValues.push(readText(root.container));
    }

    const Child = memo(function Child(): ReactElement {
      const value = virtualStore(state => state.value);
      useLayoutEffect(recordCommittedValues);
      return createElement('span', { 'data-testid': 'child' }, value);
    });

    function Parent(): ReactElement {
      const value = baseStore(state => state.value);
      useLayoutEffect(recordCommittedValues);
      return createElement('div', null, createElement('span', { 'data-testid': 'parent' }, value), createElement(Child));
    }

    try {
      root.render(createElement(Parent));
      expect(readText(root.container)).toEqual({ child: 'a', parent: 'a' });

      act(() => {
        baseStore.setState({ value: 'b' });
      });

      expect(readText(root.container)).toEqual({ child: 'b', parent: 'b' });
      expect(committedValues.every(values => values.child === values.parent)).toBe(true);

      await act(flushMicrotasks);

      expect(readText(root.container)).toEqual({ child: 'b', parent: 'b' });
    } finally {
      root.unmount();
    }
  });
});

function readText(container: HTMLDivElement): { child: string | null; parent: string | null } {
  return {
    child: container.querySelector('[data-testid="child"]')?.textContent ?? null,
    parent: container.querySelector('[data-testid="parent"]')?.textContent ?? null,
  };
}
