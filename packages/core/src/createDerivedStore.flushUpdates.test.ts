import { expectTypeOf } from 'vitest';
import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';
import { isDerivedStore } from './internal/storeUtils';
import type { DebouncedDerivedStore, DerivedStore } from './types';

afterEach(() => {
  vi.useRealTimers();
});

describe('derived store flushUpdates', () => {
  it.each([undefined, Object.is, {}, { keepAlive: true }])('omits flushUpdates without debounce, options=%s', options => {
    const source = createBaseStore(() => 1);
    const store = createDerivedStore($ => $(source), options);

    try {
      expect(store).not.toHaveProperty('flushUpdates');
      expect(isDerivedStore(store)).toBe(true);
      expect(isDerivedStore(source)).toBe(false);
      expectTypeOf(store).toEqualTypeOf<DerivedStore<number>>();
      expectTypeOf(store).not.toHaveProperty('flushUpdates');
    } finally {
      store.destroy();
    }
  });

  it.each([50, { delay: 50 }])('flushes pending updates and cancels them on destroy, debounce=%s', async debounce => {
    vi.useFakeTimers();
    const source = createBaseStore(() => 1);
    const store = createDerivedStore($ => $(source), { debounce });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    try {
      expect(store.flushUpdates).toBeTypeOf('function');
      expect(isDerivedStore(store)).toBe(true);
      expectTypeOf(store).toEqualTypeOf<DebouncedDerivedStore<number>>();

      source.setState(2);
      await flushMicrotasks();
      expect(listener).not.toHaveBeenCalled();

      store.flushUpdates();
      await flushMicrotasks();
      expect(listener.mock.calls).toEqual([[2, 1]]);

      source.setState(3);
      await flushMicrotasks();
      store.destroy();
      await vi.advanceTimersByTimeAsync(50);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
      store.destroy();
    }
  });
});
