import { flushMicrotasks } from './async.testUtils';
import { createQueryStore, defaultRetryDelay, getQueryKey } from './createQueryStore';
import type { RetryFailureParams } from './queryStore/types';

type TestData = string;
type TestParams = { id: number };

const TEST_PARAMS: TestParams = { id: 1 };
const TEST_QUERY_KEY = getQueryKey(TEST_PARAMS);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createQueryStore retry policy', () => {
  it('applies numeric retry limits with the default backoff', async () => {
    vi.useFakeTimers();

    const error = new Error('Fetch failed');
    const fetcher = vi.fn(async () => {
      throw error;
    });
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      fetcher,
      onError,
      params: TEST_PARAMS,
      retry: 2,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks(3);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenLastCalledWith({
        error,
        params: TEST_PARAMS,
        queryKey: TEST_QUERY_KEY,
        retryCount: 0,
        willRetry: true,
      });
      expect(store.getState().queryCache[TEST_QUERY_KEY]?.errorInfo).toMatchObject({ retryAllowed: true, retryCount: 0 });

      await vi.advanceTimersByTimeAsync(defaultRetryDelay(0));

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenLastCalledWith({
        error,
        params: TEST_PARAMS,
        queryKey: TEST_QUERY_KEY,
        retryCount: 1,
        willRetry: true,
      });
      expect(store.getState().queryCache[TEST_QUERY_KEY]?.errorInfo).toMatchObject({ retryAllowed: true, retryCount: 1 });

      await vi.advanceTimersByTimeAsync(defaultRetryDelay(1));

      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenLastCalledWith({
        error,
        params: TEST_PARAMS,
        queryKey: TEST_QUERY_KEY,
        retryCount: 2,
        willRetry: false,
      });
      expect(store.getState().queryCache[TEST_QUERY_KEY]?.errorInfo).toMatchObject({ retryAllowed: false, retryCount: 2 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('configures retry eligibility and delay independently', async () => {
    vi.useFakeTimers();

    const error = new Error('Fetch failed');
    const retryFailures: RetryFailureParams<TestParams>[] = [];
    const delayFailures: RetryFailureParams<TestParams>[] = [];
    const fetcher = vi.fn(async () => {
      throw error;
    });
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      fetcher,
      onError,
      params: TEST_PARAMS,
      retry: failure => {
        retryFailures.push(failure);
        return failure.retryCount < 2;
      },
      retryDelay: failure => {
        delayFailures.push(failure);
        return failure.retryCount === 0 ? 25 : 50;
      },
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks(3);
      await vi.advanceTimersByTimeAsync(25);
      await vi.advanceTimersByTimeAsync(50);

      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(retryFailures).toEqual([
        { error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 0 },
        { error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 1 },
        { error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 2 },
      ]);
      expect(delayFailures).toEqual(retryFailures.slice(0, 2));
      expect(onError.mock.calls.map(call => call[0])).toEqual([
        { error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 0, willRetry: true },
        { error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 1, willRetry: true },
        { error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 2, willRetry: false },
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('does not count a scheduled retry that is canceled before it starts', async () => {
    vi.useFakeTimers();

    const retryCounts: number[] = [];
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw new Error('Fetch failed');
      },
      onError,
      params: TEST_PARAMS,
      retry: failure => {
        retryCounts.push(failure.retryCount);
        return failure.retryCount === 0;
      },
      retryDelay: 100,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks(3);
      store.setState({ enabled: false });
      await vi.advanceTimersByTimeAsync(100);

      store.setState({ enabled: true });
      await flushMicrotasks(3);
      await vi.advanceTimersByTimeAsync(100);

      expect(retryCounts).toEqual([0, 0, 1]);
      expect(onError.mock.calls.map(call => call[0].willRetry)).toEqual([true, true, false]);
    } finally {
      unsubscribe();
    }
  });

  it('reports when an allowed retry cannot be scheduled', async () => {
    const error = new Error('Fetch failed');
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw error;
      },
      onError,
      params: TEST_PARAMS,
      retry: 1,
    });

    await store.getState().fetch(undefined, { force: true });

    expect(onError).toHaveBeenCalledWith({ error, params: TEST_PARAMS, queryKey: TEST_QUERY_KEY, retryCount: 0, willRetry: false });
    expect(store.getState().queryCache[TEST_QUERY_KEY]?.errorInfo?.retryAllowed).toBe(true);
  });

  it('keeps retry progress when data caching is disabled', async () => {
    vi.useFakeTimers();

    const fetcher = vi.fn(async () => {
      throw new Error('Fetch failed');
    });
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      disableCache: true,
      fetcher,
      onError,
      params: TEST_PARAMS,
      retry: ({ retryCount }) => retryCount === 0,
      retryDelay: 0,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks(3);
      await vi.runOnlyPendingTimersAsync();

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls.map(call => call[0])).toMatchObject([
        { retryCount: 0, willRetry: true },
        { retryCount: 1, willRetry: false },
      ]);
      expect(store.getState().queryCache).toEqual({});
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('reports every uncached failure without writing to the query cache', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Fetch failed');
    });
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      disableCache: true,
      fetcher,
      onError,
      params: TEST_PARAMS,
      retry: false,
    });

    await store.getState().fetch(undefined, { force: true });
    await store.getState().fetch(undefined, { force: true });

    expect(onError.mock.calls.map(call => call[0])).toMatchObject([
      { retryCount: 0, willRetry: false },
      { retryCount: 0, willRetry: false },
    ]);
    expect(store.getState().queryCache).toEqual({});
  });
});
