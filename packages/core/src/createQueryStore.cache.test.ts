import { deferred, flushMacrotask } from './async.testUtils';
import { createQueryStore } from './createQueryStore';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('query cache selection', () => {
  it.each([false, true])('prunes expired entries after a non-primary fetch with keepPreviousData=%s', async keepPreviousData => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cacheTime = 5 * 60 * 1000;
    const store = createQueryStore({
      cacheTime,
      disableAutoRefetching: true,
      keepPreviousData,
      params: { id: 'primary' },
      fetcher: async ({ id }) => `data-${id}`,
      staleTime: Infinity,
    });

    try {
      await store.getState().fetch({ id: 'unused' });
      await store.getState().fetch();
      const completedState = store.getState();
      const selectedEntry = completedState.getCacheEntry();
      vi.setSystemTime(Date.now() + cacheTime);

      await store.getState().fetch({ id: 'other' });
      const state = store.getState();
      expect(state.queryKey).toBe(completedState.queryKey);
      expect(state.lastFetchedAt).toBe(completedState.lastFetchedAt);
      expect(state.status).toBe(completedState.status);
      expect(state.error).toBeNull();
      expect(state.getCacheEntry()).toEqual(keepPreviousData ? selectedEntry : null);
      expect(state.getData()).toBe(keepPreviousData ? 'data-primary' : null);
      expect(state.getCacheEntry({ id: 'unused' })).toBeNull();
      expect(state.getData({ id: 'other' })).toBe('data-other');

      await state.fetch({ id: 'replacement' }, { updateQueryKey: true });
      expect(store.getState().getData()).toBe('data-replacement');
      expect(store.getState().getCacheEntry({ id: 'primary' })).toBeNull();
    } finally {
      store.getState().reset();
    }
  });
});

describe('query resubscription', () => {
  it('clears loading when a completed read loses its last subscriber and is later reused', async () => {
    const first = deferred<string>();
    const fetcher = vi.fn(() => first.promise);
    const store = createQueryStore({ fetcher, staleTime: Infinity });
    const unsubscribe = store.subscribe(() => {});
    const read = store.getState().fetch();
    first.resolve('completed data');
    await first.promise;
    unsubscribe();
    expect(await read).toBe('completed data');

    const unsubscribeAgain = store.subscribe(() => {});

    try {
      await flushMacrotask();
      expect(store.getState().getData()).toBe('completed data');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getState().getStatus('isLoading')).toBe(false);
    } finally {
      unsubscribeAgain();
      store.getState().reset();
    }
  });
});
