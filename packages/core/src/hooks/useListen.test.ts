/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from 'react';
import { createBaseStore } from '../createBaseStore';
import { createMountedRoot } from '../react.testUtils';
import { useListen } from './useListen';

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
});
