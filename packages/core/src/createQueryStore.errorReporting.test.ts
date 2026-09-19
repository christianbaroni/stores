import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushMicrotasks } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { StoresError } from './internal/errors';
import { logger } from './internal/logger';
import { QueryStatuses } from './queryStore/types';

type TestData = string;
type TestParams = { id: number };

const TEST_PARAMS: TestParams = { id: 1 };
const TEST_STORE_IDENTIFIER = getQueryKey(TEST_PARAMS);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function buildMessage(stage: string): string {
  return `[createQueryStore: ${TEST_STORE_IDENTIFIER}]: ${stage} failed`;
}

function readStoreError(value: unknown): StoresError {
  expect(value).toBeInstanceOf(StoresError);
  if (value instanceof StoresError) return value;
  throw new Error('Expected StoresError');
}

function expectStoreError(value: unknown, stage: string, cause: Error): StoresError {
  const error = readStoreError(value);
  expect(error.message).toBe(buildMessage(stage));
  expect(error.cause).toBe(cause);
  return error;
}

describe('createQueryStore error reporting', () => {
  it('keeps fetcher failures out of the global logger', async () => {
    const fetchError = new Error('Fetch failed');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw fetchError;
      },
      retry: 0,
      params: TEST_PARAMS,
    });

    await expect(store.getState().fetch()).resolves.toBeNull();

    expect(loggerError).not.toHaveBeenCalled();
    expect(store.getState().error).toBe(fetchError);
    expect(store.getState().status).toBe(QueryStatuses.Error);
  });

  it('reports transform failures as store lifecycle failures', async () => {
    const transformError = new Error('Bad transform');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const store = createQueryStore<TestData, TestParams>({
      fetcher: async params => `data-${params.id}`,
      retry: 0,
      params: TEST_PARAMS,
      transform: () => {
        throw transformError;
      },
    });

    await expect(store.getState().fetch()).resolves.toBeNull();

    expect(loggerError).toHaveBeenCalledTimes(1);
    const error = expectStoreError(loggerError.mock.calls[0]?.[0], 'transform', transformError);
    expect(store.getState().error).toBe(error);
    expect(store.getState().status).toBe(QueryStatuses.Error);
  });

  it('reports setData failures as store lifecycle failures', async () => {
    type CustomState = { customData: TestData | null };

    const setDataError = new Error('Bad setData');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const store = createQueryStore<TestData, TestParams, CustomState>(
      {
        fetcher: async params => `data-${params.id}`,
        retry: 0,
        params: TEST_PARAMS,
        setData: () => {
          throw setDataError;
        },
      },
      () => ({ customData: null })
    );

    await expect(store.getState().fetch()).resolves.toBeNull();

    expect(loggerError).toHaveBeenCalledTimes(1);
    const error = expectStoreError(loggerError.mock.calls[0]?.[0], 'setData', setDataError);
    expect(store.getState().error).toBe(error);
    expect(store.getState().status).toBe(QueryStatuses.Error);
  });

  it('reports retry policy failures and ends the retry sequence', async () => {
    const fetchError = new Error('Fetch failed');
    const retryError = new Error('Bad retry policy');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();

    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw fetchError;
      },
      onError,
      params: TEST_PARAMS,
      retry: () => {
        throw retryError;
      },
    });

    await expect(store.getState().fetch()).resolves.toBeNull();

    expect(loggerError).toHaveBeenCalledTimes(1);
    expectStoreError(loggerError.mock.calls[0]?.[0], 'retry callback', retryError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ error: fetchError, willRetry: false });
    expect(store.getState().error).toBe(fetchError);
    expect(store.getState().status).toBe(QueryStatuses.Error);
  });

  it('reports retry delay failures and ends the retry sequence', async () => {
    vi.useFakeTimers();

    const fetchError = new Error('Fetch failed');
    const retryDelayError = new Error('Bad retry delay');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw fetchError;
      },
      onError,
      params: TEST_PARAMS,
      retry: 1,
      retryDelay: () => {
        throw retryDelayError;
      },
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await flushMicrotasks(3);

      expect(loggerError).toHaveBeenCalledTimes(1);
      expectStoreError(loggerError.mock.calls[0]?.[0], 'retryDelay callback', retryDelayError);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ error: fetchError, willRetry: false });
      expect(store.getState().error).toBe(fetchError);
      expect(store.getState().status).toBe(QueryStatuses.Error);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('reports onError failures without replacing the query error', async () => {
    const fetchError = new Error('Fetch failed');
    const onErrorError = new Error('Bad onError');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw fetchError;
      },
      retry: 0,
      onError: () => {
        throw onErrorError;
      },
      params: TEST_PARAMS,
    });

    await expect(store.getState().fetch()).resolves.toBeNull();

    expect(loggerError).toHaveBeenCalledTimes(1);
    expectStoreError(loggerError.mock.calls[0]?.[0], 'onError callback', onErrorError);
    expect(store.getState().error).toBe(fetchError);
    expect(store.getState().status).toBe(QueryStatuses.Error);
  });

  it('reports onFetched failures without failing the query', async () => {
    const onFetchedError = new Error('Bad onFetched');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const store = createQueryStore<TestData, TestParams>({
      fetcher: async params => `data-${params.id}`,
      onFetched: () => {
        throw onFetchedError;
      },
      params: TEST_PARAMS,
    });

    await expect(store.getState().fetch()).resolves.toBe('data-1');

    expect(loggerError).toHaveBeenCalledTimes(1);
    expectStoreError(loggerError.mock.calls[0]?.[0], 'onFetched callback', onFetchedError);
    expect(store.getState().error).toBeNull();
    expect(store.getState().status).toBe(QueryStatuses.Success);
  });
});
