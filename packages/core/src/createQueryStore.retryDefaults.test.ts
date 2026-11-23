import { flushMicrotasks } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { configureStores } from './internal/config';
import { logger } from './internal/logger';

type TestParams = { id: number };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('query store retry defaults', () => {
  it('configures retry eligibility, delay, and error reporting globally', async () => {
    vi.useFakeTimers();

    const fetchError = new Error('Fetch failed');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    configureStores({
      queryStoreDefaults: {
        logFetchErrors: true,
        onError,
        retry: 1,
        retryDelay: 50,
      },
    });

    const params: TestParams = { id: 1 };
    const fetcher = vi.fn(async () => {
      throw fetchError;
    });
    const store = createQueryStore<string, TestParams>({ fetcher, params });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks(3);
      await vi.advanceTimersByTimeAsync(49);
      expect(fetcher).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(loggerError).toHaveBeenCalledTimes(2);
      expect(loggerError.mock.calls[0]?.[0]).toMatchObject({
        cause: fetchError,
        message: `[createQueryStore: ${getQueryKey(params)}]: fetch failed`,
      });
      expect(onError.mock.calls.map(call => call[0])).toMatchObject([
        { params, queryKey: getQueryKey(params), retryCount: 0, willRetry: true },
        { params, queryKey: getQueryKey(params), retryCount: 1, willRetry: false },
      ]);
    } finally {
      unsubscribe();
    }
  });
});
