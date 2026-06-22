import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createQueryStore } from './createQueryStore';
import type { QueryStore } from './queryStore/types';

describe('createQueryStore reactive staleTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears a scheduled refetch when reactive staleTime becomes infinite', async () => {
    vi.useFakeTimers();

    const staleTimeStore = createBaseStore<{ value: number; setValue: (value: number) => void }>(set => ({
      value: 100,
      setValue: value => set({ value }),
    }));
    const fetcher = vi.fn(() => Promise.resolve('data'));
    const store = createQueryStore<string, { id: number }>({
      fetcher,
      params: { id: 1 },
      staleTime: $ => $(staleTimeStore).value,
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      staleTimeStore.getState().setValue(Infinity);
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(100);
      await flushMicrotasks();

      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('reschedules an active refetch timer when reactive staleTime shrinks', async () => {
    vi.useFakeTimers();

    const staleTimeStore = createBaseStore<{ value: number; setValue: (value: number) => void }>(set => ({
      value: 1000,
      setValue: value => set({ value }),
    }));
    const fetcher = vi.fn(() => Promise.resolve('data'));
    const store = createQueryStore<string, { id: number }>({
      fetcher,
      params: { id: 1 },
      staleTime: $ => $(staleTimeStore).value,
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      staleTimeStore.getState().setValue(200);
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(99);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('does not run a scheduled refetch after the store is disabled', async () => {
    vi.useFakeTimers();

    const fetcher = vi.fn(() => Promise.resolve('data'));
    const store = createQueryStore<string, { id: number }>({
      fetcher,
      params: { id: 1 },
      staleTime: 100,
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      store.setState({ enabled: false });
      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();

      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('updates reactive staleTime before existing source listeners read freshness', async () => {
    let store: QueryStore<string, { id: number }> | undefined;
    const staleTimeStore = createBaseStore<{ value: number; setValue: (value: number) => void }>(set => ({
      value: Infinity,
      setValue: value => set({ value }),
    }));
    const observations: boolean[] = [];

    staleTimeStore.subscribe(() => {
      if (store) observations.push(store.getState().isStale());
    });

    store = createQueryStore<string, { id: number }>({
      fetcher: async params => `data-${params.id}`,
      params: { id: 1 },
      staleTime: $ => $(staleTimeStore).value,
    });

    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks();

      expect(store.getState().getData()).toBe('data-1');
      expect(store.getState().isStale()).toBe(false);

      staleTimeStore.getState().setValue(0);

      expect(observations).toEqual([true]);
      expect(store.getState().isStale()).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
