import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createQueryStore, getQueryKey } from './createQueryStore';

vi.mock('#env', () => ({
  IS_ANDROID: false,
  IS_BROWSER: false,
  IS_DEV: true,
  IS_IOS: false,
  IS_REACT_NATIVE: false,
  IS_TEST: false,
}));

describe('createQueryStore paramChangeThrottle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the current fetch promptly, then throttles while the replacement is in flight', async () => {
    vi.useFakeTimers();

    type Params = { id: number };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const abortedIds: number[] = [];
    const fetcher = vi.fn((params: Params, abortController: AbortController | null) => {
      abortController?.signal.addEventListener('abort', () => abortedIds.push(params.id));
      return new Promise<string>(() => {
        return;
      });
    });

    const store = createQueryStore<string, Params>({
      fetcher,
      keepPreviousData: true,
      paramChangeThrottle: 50,
      params: { id: $ => $(source, state => state.id) },
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toEqual({ id: 1 });

      source.getState().setId(2);
      expect(abortedIds).toEqual([]);

      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ id: 2 });
      expect(abortedIds).toEqual([1]);

      source.getState().setId(3);

      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(abortedIds).toEqual([1]);

      await vi.advanceTimersByTimeAsync(49);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(abortedIds).toEqual([1]);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls[2][0]).toEqual({ id: 3 });
      expect(abortedIds).toEqual([1, 2]);
    } finally {
      unsubscribe();
    }
  });

  it('allows the active replacement fetch to populate while later param changes are throttled', async () => {
    vi.useFakeTimers();

    type Params = { id: number };
    type CustomState = { data: string | null };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const abortedIds: number[] = [];
    const resolvers: ((data: string) => void)[] = [];
    const fetcher = vi.fn((params: Params, abortController: AbortController | null) => {
      abortController?.signal.addEventListener('abort', () => abortedIds.push(params.id));
      return new Promise<string>(resolve => {
        resolvers.push(resolve);
      });
    });

    const store = createQueryStore<string, Params, CustomState>(
      {
        fetcher,
        keepPreviousData: true,
        paramChangeThrottle: 50,
        params: { id: $ => $(source, state => state.id) },
        setData: ({ data, set }) => {
          set({ data });
        },
      },
      () => ({ data: null })
    );

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toEqual({ id: 1 });

      source.getState().setId(2);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ id: 2 });
      expect(abortedIds).toEqual([1]);

      source.getState().setId(3);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);

      resolvers[1]('data-2');
      await flushMicrotasks();
      expect(store.getState().data).toBe('data-2');
      expect(fetcher).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls[2][0]).toEqual({ id: 3 });
      expect(abortedIds).toEqual([1]);

      resolvers[2]('data-3');
      await flushMicrotasks();
      expect(store.getState().data).toBe('data-3');
    } finally {
      unsubscribe();
    }
  });

  it('allows a fetch that resolved before param change to commit', async () => {
    vi.useFakeTimers();

    type Params = { id: number };
    type CustomState = { data: string | null };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const resolvers: ((data: string) => void)[] = [];
    const fetcher = vi.fn(
      (_: Params) =>
        new Promise<string>(resolve => {
          resolvers.push(resolve);
        })
    );

    const store = createQueryStore<string, Params, CustomState>(
      {
        fetcher,
        keepPreviousData: true,
        paramChangeThrottle: 50,
        params: { id: $ => $(source, state => state.id) },
        setData: ({ data, set }) => {
          set({ data });
        },
      },
      () => ({ data: null })
    );

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      expect(fetcher).toHaveBeenCalledTimes(1);

      resolvers[0]('data-1');
      source.getState().setId(2);

      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(store.getState().data).toBe('data-1');

      resolvers[1]('data-2');
      await flushMicrotasks();
      expect(store.getState().data).toBe('data-2');
    } finally {
      unsubscribe();
    }
  });

  it('replaces the first active fetch after params changed while inactive', async () => {
    vi.useFakeTimers();

    type Params = { id: number };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const fetcher = vi.fn((_: Params) => {
      return new Promise<string>(() => {
        return;
      });
    });

    const store = createQueryStore<string, Params>({
      fetcher,
      keepPreviousData: true,
      paramChangeThrottle: 50,
      params: { id: $ => $(source, state => state.id) },
    });

    source.getState().setId(2);
    await flushMicrotasks();
    expect(fetcher).not.toHaveBeenCalled();

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toEqual({ id: 2 });

      source.getState().setId(3);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ id: 3 });

      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('replaces the first enabled fetch promptly when params start from empty', async () => {
    vi.useFakeTimers();

    type Params = { ids: string[] };

    const source = createBaseStore<{ ids: string[]; setIds: (ids: string[]) => void }>(set => ({
      ids: [],
      setIds: ids => set({ ids }),
    }));

    const abortedIds: string[][] = [];
    const fetcher = vi.fn((params: Params, abortController: AbortController | null) => {
      abortController?.signal.addEventListener('abort', () => abortedIds.push(params.ids));
      return new Promise<string>(() => {
        return;
      });
    });

    const store = createQueryStore<string, Params>({
      enabled: $ => $(source, state => state.ids.length > 0),
      fetcher,
      keepPreviousData: true,
      paramChangeThrottle: 50,
      params: { ids: $ => $(source, state => state.ids) },
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      expect(fetcher).not.toHaveBeenCalled();

      source.getState().setIds(['BTC']);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toEqual({ ids: ['BTC'] });

      source.getState().setIds(['BTC', 'ETH']);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ ids: ['BTC', 'ETH'] });
      expect(abortedIds).toEqual([['BTC']]);

      source.getState().setIds(['BTC', 'ETH', 'SOL']);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(abortedIds).toEqual([['BTC']]);

      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls[2][0]).toEqual({ ids: ['BTC', 'ETH', 'SOL'] });
      expect(abortedIds).toEqual([['BTC'], ['BTC', 'ETH']]);
    } finally {
      unsubscribe();
    }
  });

  it('throttles replacement fetches after a successful fetch', async () => {
    vi.useFakeTimers();

    type Params = { id: number };
    type CustomState = { data: string | null };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const fetcher = vi.fn((params: Params) => {
      return new Promise<string>(resolve => {
        setTimeout(() => resolve(`data-${params.id}`), 10);
      });
    });

    const store = createQueryStore<string, Params, CustomState>(
      {
        disableCache: true,
        fetcher,
        keepPreviousData: true,
        paramChangeThrottle: 50,
        params: { id: $ => $(source, state => state.id) },
        setData: ({ data, set }) => {
          set({ data });
        },
      },
      () => ({ data: null })
    );

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(store.getState().data).toBe('data-1');

      source.getState().setId(2);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10);
      expect(store.getState().data).toBe('data-2');
    } finally {
      unsubscribe();
    }
  });

  it('keeps the current key until a throttled replacement is committed when previous data is not kept', async () => {
    vi.useFakeTimers();

    type Params = { id: number };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const resolvers: ((data: string) => void)[] = [];
    const fetcher = vi.fn((_: Params) => {
      return new Promise<string>(resolve => {
        resolvers.push(resolve);
      });
    });

    const store = createQueryStore<string, Params>({
      fetcher,
      keepPreviousData: false,
      paramChangeThrottle: 50,
      params: { id: $ => $(source, state => state.id) },
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      expect(fetcher).toHaveBeenCalledTimes(1);
      resolvers[0]('data-1');
      await flushMicrotasks();
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 1 }));
      expect(store.getState().getData()).toBe('data-1');

      source.getState().setId(2);
      await flushMicrotasks();

      expect(store.getState().queryKey).toBe(getQueryKey({ id: 1 }));
      expect(store.getState().getData()).toBe('data-1');
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ id: 2 });
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 2 }));
      expect(store.getState().getData()).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('cancels scheduled stale refetches when params change before a throttled replacement', async () => {
    vi.useFakeTimers();

    type Params = { id: number };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const fetcher = vi.fn((params: Params) => Promise.resolve(`data-${params.id}`));

    const store = createQueryStore<string, Params>({
      fetcher,
      keepPreviousData: true,
      paramChangeThrottle: 50,
      params: { id: $ => $(source, state => state.id) },
      staleTime: 20,
    });

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toEqual({ id: 1 });

      source.getState().setId(2);

      await vi.advanceTimersByTimeAsync(20);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ id: 2 });
    } finally {
      unsubscribe();
    }
  });

  it('throttles replacements during a same-key stale refetch after data exists', async () => {
    vi.useFakeTimers();

    type Params = { id: number };
    type CustomState = { data: string | null };

    const source = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
      id: 1,
      setId: id => set({ id }),
    }));

    const abortedIds: number[] = [];
    const resolvers: ((data: string) => void)[] = [];
    const fetcher = vi.fn((params: Params, abortController: AbortController | null) => {
      abortController?.signal.addEventListener('abort', () => abortedIds.push(params.id));
      return new Promise<string>(resolve => {
        resolvers.push(resolve);
      });
    });

    const store = createQueryStore<string, Params, CustomState>(
      {
        fetcher,
        keepPreviousData: true,
        paramChangeThrottle: 50,
        params: { id: $ => $(source, state => state.id) },
        setData: ({ data, set }) => {
          set({ data });
        },
        staleTime: 20,
      },
      () => ({ data: null })
    );

    const unsubscribe = store.subscribe(() => {
      return;
    });

    try {
      resolvers[0]('data-1');
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getState().data).toBe('data-1');

      await vi.advanceTimersByTimeAsync(20);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toEqual({ id: 1 });

      source.getState().setId(2);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(abortedIds).toEqual([]);
      expect(store.getState().data).toBe('data-1');

      await vi.advanceTimersByTimeAsync(49);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(abortedIds).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls[2][0]).toEqual({ id: 2 });
      expect(abortedIds).toEqual([1]);
    } finally {
      unsubscribe();
    }
  });
});
