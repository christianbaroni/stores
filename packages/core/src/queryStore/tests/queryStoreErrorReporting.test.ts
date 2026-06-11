import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryStore, getQueryKey } from '../../createQueryStore';
import { StoresError } from '../../errors';
import { logger } from '../../logger';
import { QueryStatuses } from '../types';

type TestData = string;
type TestParams = { id: number };

const TEST_PARAMS: TestParams = { id: 1 };
const TEST_STORE_IDENTIFIER = getQueryKey(TEST_PARAMS);

afterEach(() => {
  vi.restoreAllMocks();
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
      maxRetries: 0,
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
      maxRetries: 0,
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
        maxRetries: 0,
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

  it('reports onError failures without replacing the query error', async () => {
    const fetchError = new Error('Fetch failed');
    const onErrorError = new Error('Bad onError');
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const store = createQueryStore<TestData, TestParams>({
      fetcher: async () => {
        throw fetchError;
      },
      maxRetries: 0,
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
