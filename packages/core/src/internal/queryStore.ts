import { IS_DEV, IS_TEST } from '#env';
import { SubscriptionManager } from '../queryStore/classes/SubscriptionManager';
import { batchStoreNotifications } from '#store/batchStoreNotifications';
import { QueryStatuses } from '../queryStore/types';
import type {
  CacheEntry,
  FetchOptions,
  InternalStateKeys,
  QueryStoreInternalState,
  QueryStatusInfo,
  QueryStoreConfig,
  QueryStoreState,
} from '../queryStore/types';
import type { BaseStoreOptions, PersistConfig, SetStatePartialArgs, StateCreator, Timeout } from '../types';
import type { InternalSubscribeArgs, InternalSubscribeOverloads, InternalUnsubscribeFn } from './types/internalSubscribeTypes';
import type { BivariantMethod } from '../types/functions';
import { hasOwn } from '../types/utils';
import { buildNullObject, nullObject } from '../utils/core';
import { createMicrotaskScheduler } from '../utils/createMicrotaskScheduler';
import { debounce } from '../utils/debounce';
import { baseStore } from './baseStore';
import { markStoreCreated } from './config';
import { StoresError, ensureError } from './errors';
import { logger } from './logger';
import { getQueryStoreDefaults } from './queryStore/queryStoreDefaults';
import { createQueryParams, trackQueryValue, type QueryParams, type TrackedValue } from './queryStore/queryParams';
import { assignStoreTag, StoreTags } from './storeUtils';
import { omitStoreMethods } from './utils/persistUtils';

// ============ Constants ====================================================== //

const SHOULD_PERSIST_INTERNAL_STATE_MAP: Record<string, boolean> = {
  /* Internal state to persist if the store is persisted */
  error: true,
  lastFetchedAt: true,
  queryCache: true,
  queryKey: true,
  status: true,

  /* Internal state and methods to discard */
  enabled: false,
  fetch: false,
  getCacheEntry: false,
  getData: false,
  getStatus: false,
  isDataExpired: false,
  isStale: false,
  reset: false,
} satisfies Record<InternalStateKeys, boolean>;

const FORCE_TRUE = Object.freeze({ force: true });
const ONCE_TRUE = Object.freeze({ once: true });

// ============ Internal Types ================================================= //

type QueryTask = () => void;

type InternalFetch<TData, TParams extends Record<string, unknown>> = (
  params?: Partial<TParams>,
  options?: FetchOptions,
  isInternalFetch?: boolean
) => Promise<TData | null>;

type InternalSetState<TData, TParams extends Record<string, unknown>, S extends QueryStoreState<TData, TParams>> = BivariantMethod<{
  set(
    partial: Partial<QueryStoreInternalState<TData, TParams>> | ((state: S) => Partial<QueryStoreInternalState<TData, TParams>>),
    replace?: false
  ): void;
}>;

type InternalQueryStore<TData, TParams extends Record<string, unknown>, S extends QueryStoreState<TData, TParams>> = ReturnType<
  typeof baseStore<S, Partial<S>, void | Promise<void>>
> & {
  setState: InternalSetState<TData, TParams, S>;
};

// ============ Shared Query Task Queue ======================================== //

const queryTaskQueue = new Set<QueryTask>();
let queryTaskFlushScheduled = false;

function scheduleQueryTask(task: QueryTask): void {
  queryTaskQueue.add(task);
  if (queryTaskFlushScheduled) return;

  queryTaskFlushScheduled = true;
  queueMicrotask(() => {
    queryTaskFlushScheduled = false;
    batchStoreNotifications(flushQueryTasks);
  });
}

function flushQueryTasks(): void {
  for (const task of queryTaskQueue) {
    queryTaskQueue.delete(task);
    task();
  }
}

// ============ Query Store Factory ================================================== //

/** @internal */
export function queryStore<
  TQueryFnData,
  TParams extends Record<string, unknown>,
  CustomState,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams, CustomState>> = Partial<QueryStoreState<TData, TParams, CustomState>>,
  PersistReturn extends void | Promise<void> = void,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>,
  creatorOrOptions?:
    | StateCreator<QueryStoreState<TData, TParams, CustomState>, CustomState>
    | BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>,
  maybeOptions?: BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>
): ReturnType<typeof baseStore<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>> {
  type S = QueryStoreState<TData, TParams, CustomState>;
  type PersistReturnType = [PersistReturn] extends Promise<void> ? PersistReturn : void;

  markStoreCreated();

  /* If arg1 is a function, it's the custom state creator; otherwise, it's options */
  const customStateCreator = typeof creatorOrOptions === 'function' ? creatorOrOptions : createEmptyState<CustomState>;
  const options = typeof creatorOrOptions === 'object' ? creatorOrOptions : maybeOptions;

  /* BaseStoreOptions is either SyncOptions or PersistWithOptionalSync */
  const storeOptions = hasStorageKey(options) ? options : undefined;
  const defaults = getQueryStoreDefaults();
  const minStaleTime = defaults.minStaleTime;

  const {
    fetcher,
    onError,
    onFetched,
    setData,
    transform,
    abortInterruptedFetches = defaults.abortInterruptedFetches,
    cacheTime = defaults.cacheTime,
    debugMode = defaults.debugMode,
    disableAutoRefetching = defaults.disableAutoRefetching,
    disableCache = false,
    enabled = true,
    keepPreviousData = defaults.keepPreviousData,
    maxRetries = defaults.maxRetries,
    paramChangeThrottle = defaults.paramChangeThrottle,
    params,
    retryDelay = defaults.retryDelay,
    staleTime: providedStaleTime = defaults.staleTime,
    suppressStaleTimeWarning = defaults.suppressStaleTimeWarning,
  } = config;

  let staleTime = typeof providedStaleTime === 'function' ? defaults.staleTime : providedStaleTime;

  if (IS_DEV && minStaleTime !== false && !disableAutoRefetching && !suppressStaleTimeWarning && staleTime < minStaleTime) {
    console.warn(
      `[createQueryStore${storeOptions?.storageKey ? `: ${storeOptions.storageKey}` : ''}] ❌ Stale times under ${
        minStaleTime / 1000
      } seconds are not recommended. Provided staleTime: ${staleTime / 1000} seconds`
    );
  }

  const abortError = new Error('[createQueryStore: AbortError] Fetch interrupted');
  const cacheTimeIsFunction = typeof cacheTime === 'function';
  const enableLogs = IS_DEV && debugMode;
  const paramKeys: (keyof TParams)[] = config.params ? Object.keys(config.params) : [];

  // ========== Internal State ==========

  let isBuildingParams = false;
  let queryParams: QueryParams<TParams>;
  let paramUnsubscribes: InternalUnsubscribeFn[] = [];
  let trackedEnabled: TrackedValue<boolean> | null = null;
  let trackedStaleTime: TrackedValue<number> | null = null;

  let activeAbortController: AbortController | null = null;
  let activeFetch: { key: string; promise?: Promise<TData | null> } | null = null;
  let activeRefetchTimeout: Timeout | null = null;
  let lastFetchKey: string | null = null;
  let lastHandledEnabled: boolean | null = null;

  const initialData = {
    enabled: typeof enabled === 'function' ? false : enabled,
    error: null,
    lastFetchedAt: null,
    queryCache: {},
    queryKey: '',
    status: QueryStatuses.Idle,
  };

  const subscriptionManager = new SubscriptionManager(disableAutoRefetching);

  function abortActiveFetch(): void {
    if (activeAbortController) {
      activeFetch = null;
      activeAbortController.abort();
      activeAbortController = null;
    }
  }

  function clearActiveRefetchTimeout(): void {
    if (activeRefetchTimeout) {
      clearTimeout(activeRefetchTimeout);
      activeRefetchTimeout = null;
    }
  }

  async function fetchWithAbortControl(params: TParams): Promise<TQueryFnData> {
    const abortController = new AbortController();
    activeAbortController = abortController;

    try {
      return await new Promise((resolve, reject) => {
        abortController.signal.addEventListener('abort', () => reject(abortError), ONCE_TRUE);
        Promise.resolve(fetcher(params, abortController)).then(resolve, reject);
      });
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  // ========== State Creator ==========

  function createState(
    set: InternalSetState<TData, TParams, S>,
    get: Parameters<StateCreator<S>>[1],
    api: Parameters<StateCreator<S>>[2]
  ): S {
    const originalSet = api.setState;

    function handleEnabledChange(prevEnabled: boolean, newEnabled: boolean): void {
      if (prevEnabled !== newEnabled && lastHandledEnabled !== newEnabled) {
        lastHandledEnabled = newEnabled;
        if (newEnabled && subscriptionManager.hasSubscribers()) {
          queueMicrotask(() => baseMethods.fetch(undefined, undefined, true));
        } else if (activeRefetchTimeout || abortInterruptedFetches) {
          if (abortInterruptedFetches) abortActiveFetch();
          clearActiveRefetchTimeout();
        }
      }
    }

    function setWithEnabledHandling(update: SetStatePartialArgs<S>[0]): ReturnType<typeof originalSet> {
      const isFunctionSetter = typeof update === 'function';
      if (isFunctionSetter || update.enabled !== undefined) {
        let handleNewEnabled: (() => void) | undefined;

        const result = originalSet(state => {
          const newPartial = isFunctionSetter ? update(state) : update;
          const newEnabled = newPartial.enabled !== undefined ? newPartial.enabled : state.enabled;
          if (newEnabled !== state.enabled) handleNewEnabled = () => handleEnabledChange(state.enabled, newEnabled);
          return newPartial;
        });

        handleNewEnabled?.();
        return result;
      } else {
        return originalSet(update);
      }
    }

    // Override the store's set method
    api.setState = setWithEnabledHandling;

    subscriptionManager.init({
      onSubscribe: (isFirstSubscription, shouldThrottle) => {
        const state = get();
        if (!state.enabled) return;

        if (isFirstSubscription) {
          const currentParams = queryParams.get();
          const currentQueryKey = queryParams.buildKey(currentParams);
          const storeQueryKey = state.queryKey;

          if (storeQueryKey !== currentQueryKey) set({ queryKey: currentQueryKey });

          if (state.isStale()) {
            baseMethods.fetch(currentParams, undefined, true);
          } else {
            scheduleNextFetch(currentParams);
          }
        } else if (disableAutoRefetching && !shouldThrottle) {
          baseMethods.fetch(undefined, undefined, true);
        }
      },

      onLastUnsubscribe: skipAbortFetch => {
        clearActiveRefetchTimeout();
        if (abortInterruptedFetches && !skipAbortFetch) {
          abortActiveFetch();
        }
      },
    });

    function scheduleNextFetch(params: TParams): void {
      if (disableAutoRefetching || staleTime <= 0 || staleTime === Infinity) return;
      if (!subscriptionManager.hasSubscribers()) return;

      clearActiveRefetchTimeout();
      const state = get();
      if (!state.enabled) return;

      const currentQueryKey = queryParams.buildKey(params);
      const lastFetchedAt =
        (disableCache ? lastFetchKey === currentQueryKey && state.lastFetchedAt : state.queryCache[currentQueryKey]?.lastFetchedAt) || null;
      const timeUntilRefetch = lastFetchedAt ? staleTime - (Date.now() - lastFetchedAt) : staleTime;

      activeRefetchTimeout = setTimeout(() => {
        if (get().enabled) baseMethods.fetch(params, FORCE_TRUE, true);
      }, timeUntilRefetch);
    }

    function getStatus(statusKey: keyof QueryStatusInfo): QueryStatusInfo[keyof QueryStatusInfo];
    function getStatus(): QueryStatusInfo;
    function getStatus(statusKey?: keyof QueryStatusInfo): QueryStatusInfo[keyof QueryStatusInfo] | QueryStatusInfo {
      const state = get();
      const status = state.status;

      switch (statusKey) {
        case 'isIdle':
          return status === QueryStatuses.Idle;
        case 'isLoading':
          return status === QueryStatuses.Loading;
        case 'isError':
        case 'isInitialLoad':
        case 'isSuccess':
        case undefined: {
          const queryKey = state.queryKey;
          const cacheEntry = state.queryCache[queryKey];
          const isError = disableCache ? status === QueryStatuses.Error : typeof cacheEntry?.errorInfo?.lastFailedAt === 'number';
          if (statusKey === 'isError') return isError;

          const lastFetchedAt = (disableCache ? lastFetchKey === queryKey && state.lastFetchedAt : cacheEntry?.lastFetchedAt) || null;
          const hasData = lastFetchedAt !== null;
          const isInitialLoad = !hasData && !isError && state.enabled;
          if (statusKey === 'isInitialLoad') return isInitialLoad;

          const isSuccess = hasData && !isError;
          if (statusKey === 'isSuccess') return isSuccess;

          return {
            isError,
            isIdle: status === QueryStatuses.Idle,
            isLoading: status === QueryStatuses.Loading,
            isInitialLoad,
            isSuccess,
          };
        }
      }
    }

    // ========== Store Methods ==========

    const baseMethods = {
      ...customStateCreator(setWithEnabledHandling, get, api),
      ...initialData,

      async fetch(
        params: TParams | Partial<TParams> | undefined,
        options: FetchOptions | undefined,
        isInternalFetch = false
      ): Promise<TData | null> {
        const skipStoreUpdates = !!options?.skipStoreUpdates;
        const state = get();

        if (!skipStoreUpdates) {
          if (!state.enabled && !options?.force) return null;
          if (isInternalFetch && !subscriptionManager.hasSubscribers()) return null;
        }

        const error = state.error;
        const storeQueryKey = state.queryKey;
        const isLoading = state.status === QueryStatuses.Loading;

        const effectiveParams = queryParams.complete(params);
        const fetchQueryKey = queryParams.buildKey(effectiveParams);

        if (isLoading && activeFetch?.promise && activeFetch.key === fetchQueryKey) {
          if (enableLogs) console.log('[🔄 Using Active Fetch 🔄] for params:', JSON.stringify(effectiveParams));
          return activeFetch.promise;
        }

        const effectiveStaleTime = options?.staleTime ?? staleTime;
        const shouldUpdateQueryKey =
          typeof options?.updateQueryKey === 'boolean'
            ? options.updateQueryKey
            : isInternalFetch
              ? keepPreviousData
              : // Manual fetch call default
                false;

        const areParamsCurrent = isInternalFetch || storeQueryKey === fetchQueryKey;
        const isMainFetchPath = (areParamsCurrent || shouldUpdateQueryKey) && !skipStoreUpdates;
        const hadActiveFetch = activeFetch !== null;

        if (abortInterruptedFetches && isMainFetchPath) {
          abortActiveFetch();
        }

        if (!options?.force) {
          /* Check for valid cached data */
          const storeLastFetchedAt = state.lastFetchedAt;
          const cacheEntry = state.queryCache[fetchQueryKey];
          const cachedLastFetchedAt = cacheEntry?.lastFetchedAt;
          const errorInfo = cacheEntry?.errorInfo;

          const errorRetriesExhausted = errorInfo && errorInfo.retryCount >= maxRetries;
          const lastFetchedAt = (disableCache ? lastFetchKey === fetchQueryKey && storeLastFetchedAt : cachedLastFetchedAt) || null;
          const isStale = !lastFetchedAt || Date.now() - lastFetchedAt >= effectiveStaleTime;

          if (!isStale && (!errorInfo || errorRetriesExhausted || skipStoreUpdates)) {
            if (isMainFetchPath && !activeRefetchTimeout && staleTime !== 0 && staleTime !== Infinity) {
              scheduleNextFetch(effectiveParams);
            }
            if (shouldUpdateQueryKey) set(state => (state.queryKey !== fetchQueryKey ? { queryKey: fetchQueryKey } : state));
            if (enableLogs) console.log('[💾 Returning Cached Data 💾] for params:', JSON.stringify(effectiveParams));
            return cacheEntry?.data ?? null;
          }
        }

        const currentFetch: NonNullable<typeof activeFetch> | null = isMainFetchPath ? { key: fetchQueryKey } : null;
        const effectiveCacheTime = options?.cacheTime ?? (cacheTimeIsFunction ? cacheTime(effectiveParams) : cacheTime);

        if (currentFetch) {
          clearActiveRefetchTimeout();
          if (shouldUpdateQueryKey && !hadActiveFetch && state.lastFetchedAt === null && storeQueryKey !== fetchQueryKey) {
            set({ error: null, queryKey: fetchQueryKey, status: QueryStatuses.Loading });
          } else if (error || !isLoading) {
            set({ error: null, status: QueryStatuses.Loading });
          }
          activeFetch = currentFetch;
        }

        async function fetchOperation(): Promise<TData | null> {
          const storeIdentifier = storeOptions?.storageKey || fetchQueryKey;

          try {
            if (enableLogs) {
              const isPartialFetch = !isInternalFetch && params && paramKeys.some(key => !(key in params));
              if (isPartialFetch) {
                console.log(
                  '[🔄 Fetching with Partial Params 🔄]\n',
                  '- Provided params:',
                  `${JSON.stringify(params)}\n`,
                  '- Filled in params:',
                  `${JSON.stringify(
                    Object.fromEntries(
                      Object.keys(effectiveParams)
                        .filter(key => !(key in params))
                        .map(key => [key, effectiveParams[key]])
                    )
                  )}`
                );
              } else {
                console.log('[🔄 Fetching 🔄] for params:', JSON.stringify(effectiveParams));
              }
            }

            const rawResult = await (abortInterruptedFetches && isMainFetchPath
              ? fetchWithAbortControl(effectiveParams)
              : fetcher(effectiveParams, null));

            const lastFetchedAt = Date.now();
            if (enableLogs) console.log('[✅ Fetch Successful ✅] for params:', JSON.stringify(effectiveParams));

            let transformedData: TData;
            try {
              transformedData = transformQueryData(rawResult, effectiveParams, transform);
            } catch (transformError) {
              throw queryStoreError(storeIdentifier, 'transform', transformError);
            }

            if (skipStoreUpdates) {
              if (enableLogs) console.log('[🥷 Successful Parallel Fetch 🥷] for params:', JSON.stringify(effectiveParams));
              if (options.skipStoreUpdates === 'withCache') {
                set(state => {
                  if (!setData) {
                    if (disableCache) return state;
                    return {
                      queryCache: {
                        ...state.queryCache,
                        [fetchQueryKey]: {
                          cacheTime: effectiveCacheTime,
                          data: transformedData,
                          errorInfo: null,
                          lastFetchedAt,
                        } satisfies CacheEntry<TData>,
                      },
                    };
                  }

                  let newState = state;
                  const cacheEntryBeforeSetData = newState.queryCache[fetchQueryKey];
                  try {
                    setData({
                      data: transformedData,
                      params: effectiveParams,
                      queryKey: fetchQueryKey,
                      set: partial => {
                        newState = typeof partial === 'function' ? { ...newState, ...partial(newState) } : { ...newState, ...partial };
                      },
                    });
                  } catch (setDataError) {
                    throw queryStoreError(storeIdentifier, 'setData', setDataError);
                  }

                  if (!disableCache && Object.is(cacheEntryBeforeSetData, newState.queryCache[fetchQueryKey])) {
                    newState = {
                      ...newState,
                      queryCache: {
                        ...newState.queryCache,
                        [fetchQueryKey]: {
                          cacheTime: effectiveCacheTime,
                          data: null,
                          errorInfo: null,
                          lastFetchedAt,
                        } satisfies CacheEntry<TData>,
                      },
                    };
                  }

                  return newState;
                });
              }

              return transformedData;
            }

            (setData ? setWithEnabledHandling : set)(state => {
              let newState: S = {
                ...state,
                error: null,
                lastFetchedAt,
                queryKey: shouldUpdateQueryKey ? fetchQueryKey : state.queryKey,
                status: QueryStatuses.Success,
              };

              if (!setData && !disableCache) {
                if (enableLogs)
                  console.log(
                    '[💾 Setting Cache 💾] for params:',
                    JSON.stringify(effectiveParams),
                    '| Has previous data?:',
                    !!newState.queryCache[fetchQueryKey]?.data
                  );
                newState.queryCache = {
                  ...newState.queryCache,
                  [fetchQueryKey]: {
                    cacheTime: effectiveCacheTime,
                    data: transformedData,
                    errorInfo: null,
                    lastFetchedAt,
                  } satisfies CacheEntry<TData>,
                };
              } else if (setData) {
                if (enableLogs) console.log('[💾 Setting Data 💾] for params:', JSON.stringify(effectiveParams));

                const cacheEntryBeforeSetData = newState.queryCache[fetchQueryKey];
                try {
                  setData({
                    data: transformedData,
                    params: effectiveParams,
                    queryKey: fetchQueryKey,
                    set: partial => {
                      newState = typeof partial === 'function' ? { ...newState, ...partial(newState) } : { ...newState, ...partial };
                    },
                  });
                } catch (setDataError) {
                  throw queryStoreError(storeIdentifier, 'setData', setDataError);
                }

                if (!disableCache && Object.is(cacheEntryBeforeSetData, newState.queryCache[fetchQueryKey])) {
                  newState.queryCache = {
                    ...newState.queryCache,
                    [fetchQueryKey]: {
                      cacheTime: effectiveCacheTime,
                      data: null,
                      errorInfo: null,
                      lastFetchedAt,
                    } satisfies CacheEntry<TData>,
                  };
                }
              }

              return disableCache || cacheTime === Infinity
                ? newState
                : pruneCache<S, TData, TParams>(keepPreviousData, fetchQueryKey, newState);
            });

            if (isMainFetchPath) {
              lastFetchKey = fetchQueryKey;
              scheduleNextFetch(effectiveParams);
            }

            if (onFetched) {
              try {
                onFetched({ data: transformedData, fetch: baseMethods.fetch, params: effectiveParams, set: setWithEnabledHandling });
              } catch (onFetchedError) {
                logger.error(queryStoreError(storeIdentifier, 'onFetched callback', onFetchedError));
              }
            }

            return transformedData ?? null;
          } catch (error) {
            if (error === abortError) {
              if (enableLogs) console.log('[❌ Fetch Aborted ❌] for params:', JSON.stringify(effectiveParams));
              return null;
            }

            const shouldThrow = !isInternalFetch && options?.throwOnError === true;
            const typedError = ensureError(error);

            if (typedError instanceof StoresError) logger.error(typedError);

            if (!isMainFetchPath) {
              if (shouldThrow) throw typedError;
              return null;
            }

            const entry = disableCache ? undefined : get().queryCache[fetchQueryKey];
            const existingRetryCount = entry?.errorInfo?.retryCount ?? 0;
            const newRetryCount = existingRetryCount + 1;

            try {
              onError?.(typedError, existingRetryCount);
            } catch (onErrorError) {
              logger.error(queryStoreError(storeIdentifier, 'onError callback', onErrorError));
            }

            if (existingRetryCount < maxRetries) {
              if (get().enabled && subscriptionManager.hasSubscribers()) {
                const errorRetryDelay = typeof retryDelay === 'function' ? retryDelay(newRetryCount, typedError) : retryDelay;
                if (errorRetryDelay !== Infinity) {
                  clearActiveRefetchTimeout();
                  activeRefetchTimeout = setTimeout(() => {
                    if (get().enabled) baseMethods.fetch(effectiveParams, FORCE_TRUE, true);
                  }, errorRetryDelay);
                }
              }

              set(state => ({
                error: typedError,
                queryCache: {
                  ...state.queryCache,
                  [fetchQueryKey]: {
                    cacheTime: entry?.cacheTime ?? effectiveCacheTime,
                    data: entry?.data ?? null,
                    lastFetchedAt: entry?.lastFetchedAt ?? null,
                    errorInfo: {
                      error: typedError,
                      lastFailedAt: Date.now(),
                      retryCount: newRetryCount,
                    },
                  } satisfies CacheEntry<TData>,
                },
                queryKey: shouldUpdateQueryKey ? fetchQueryKey : state.queryKey,
                status: QueryStatuses.Error,
              }));
            } else {
              /* Max retries exhausted */
              set(state => ({
                error: typedError,
                queryCache: {
                  ...state.queryCache,
                  [fetchQueryKey]: {
                    cacheTime: entry?.cacheTime ?? effectiveCacheTime,
                    data: entry?.data ?? null,
                    lastFetchedAt: entry?.lastFetchedAt ?? null,
                    errorInfo: {
                      error: typedError,
                      lastFailedAt: Date.now(),
                      retryCount: maxRetries,
                    },
                  } satisfies CacheEntry<TData>,
                },
                queryKey: shouldUpdateQueryKey ? fetchQueryKey : state.queryKey,
                status: QueryStatuses.Error,
              }));
            }

            if (shouldThrow) throw typedError;
            return null;
          } finally {
            if (activeFetch === currentFetch) activeFetch = null;
          }
        }

        if (!currentFetch) return fetchOperation();

        currentFetch.promise = fetchOperation();
        return currentFetch.promise;
      },

      getCacheEntry(paramsOrQueryKey?: TParams | Partial<TParams> | string): CacheEntry<TData> | null {
        if (disableCache) return null;
        const state = get();
        const currentQueryKey = !paramsOrQueryKey
          ? state.queryKey
          : typeof paramsOrQueryKey === 'string'
            ? paramsOrQueryKey
            : queryParams.buildKey(queryParams.complete(paramsOrQueryKey));

        return state.queryCache[currentQueryKey] ?? null;
      },

      getData(paramsOrQueryKey?: TParams | string): TData | null {
        if (disableCache) return null;

        const state = get();
        const cacheEntry = state.getCacheEntry(paramsOrQueryKey);
        if (!cacheEntry || cacheEntry.data === null) return null;

        if (keepPreviousData) return cacheEntry.data;
        const isExpired = !!cacheEntry.lastFetchedAt && Date.now() - cacheEntry.lastFetchedAt >= cacheEntry.cacheTime;
        return isExpired ? null : cacheEntry.data;
      },

      getStatus,

      isDataExpired(cacheTimeOverride?: number): boolean {
        const state = get();
        const cacheEntry = state.queryCache[state.queryKey];
        const currentQueryKey = state.queryKey;
        const storeLastFetchedAt = state.lastFetchedAt;

        const lastFetchedAt = (disableCache ? lastFetchKey === currentQueryKey && storeLastFetchedAt : cacheEntry?.lastFetchedAt) || null;
        if (!lastFetchedAt) return true;

        const effectiveCacheTime = cacheTimeOverride ?? cacheEntry?.cacheTime;
        return effectiveCacheTime === undefined || Date.now() - lastFetchedAt >= effectiveCacheTime;
      },

      isStale(staleTimeOverride?: number): boolean {
        const state = get();
        const currentQueryKey = state.queryKey;
        const lastFetchedAt =
          (disableCache ? lastFetchKey === currentQueryKey && state.lastFetchedAt : state.queryCache[currentQueryKey]?.lastFetchedAt) ||
          null;

        if (!lastFetchedAt) return true;
        const effectiveStaleTime = staleTimeOverride ?? staleTime;
        return Date.now() - lastFetchedAt >= effectiveStaleTime;
      },

      reset(resetStoreState = false): void {
        for (const unsub of paramUnsubscribes) unsub();
        paramUnsubscribes = [];
        queryParams = createQueryParams<TParams, S>(undefined, queryStore, paramKeys);
        trackedEnabled = null;
        trackedStaleTime = null;

        abortActiveFetch();
        clearActiveRefetchTimeout();

        activeFetch = null;
        lastFetchKey = null;
        if (resetStoreState) set(initialData);
      },
    };

    // ========== Subscribe Override ==========

    const originalSubscribe: InternalSubscribeOverloads<S> = api.subscribe;
    api.subscribe = (...args: InternalSubscribeArgs<S>) => {
      const internalUnsubscribe = isBuildingParams ? undefined : subscriptionManager.subscribe();
      const unsubscribe = args.length === 1 ? originalSubscribe(args[0]) : originalSubscribe(args[0], args[1], args[2]);
      return (skipAbortFetch?: boolean) => {
        internalUnsubscribe?.(skipAbortFetch);
        unsubscribe();
      };
    };

    return baseMethods;
  }

  // ========== Store Initialization ==========

  const queryStore: InternalQueryStore<TData, TParams, S> = storeOptions?.storageKey
    ? baseStore<S, PersistedState, PersistReturnType>(
        createState,
        buildNullObject<BaseStoreOptions<S, PersistedState, PersistReturnType>, { partialize: (state: S) => PersistedState }>(
          storeOptions,
          { partialize: createBlendedPartialize<TData, TParams, S, CustomState, PersistedState>(keepPreviousData, storeOptions.partialize) }
        )
      )
    : options && !('storageKey' in options)
      ? baseStore<S, PersistedState, PersistReturnType>(createState, options)
      : baseStore<S, PersistedState, PersistReturnType>(createState);

  const initialState = queryStore.getState();
  const error = initialState.error;
  const initialStoreEnabled = initialState.enabled;
  const queryKey = initialState.queryKey;
  const queryStoreFetch: InternalFetch<TData, TParams> = initialState.fetch;

  if (queryKey && !error) lastFetchKey = queryKey;

  // ========== Params ==========

  isBuildingParams = true;

  queryParams = createQueryParams<TParams, S>(params, queryStore, paramKeys);

  if (typeof enabled === 'function') {
    trackedEnabled = trackQueryValue(enabled, queryStore);
  }

  if (typeof config.staleTime === 'function') {
    trackedStaleTime = trackQueryValue(config.staleTime, queryStore);
    staleTime = trackedStaleTime.initialValue;
  }

  const queueParamFetch = createMicrotaskScheduler((params: TParams | undefined) => {
    void queryStoreFetch(params, undefined, true);
  }, scheduleQueryTask);

  function applyParamChange(): void {
    if (!keepPreviousData) {
      const currentParams = queryParams.get();
      queryStore.setState({ queryKey: queryParams.buildKey(currentParams) });
      queueParamFetch(currentParams);
    } else {
      queueParamFetch(undefined);
    }
  }

  const throttledParamChange =
    IS_TEST || !paramChangeThrottle
      ? undefined
      : debounce(
          applyParamChange,
          typeof paramChangeThrottle === 'number' ? paramChangeThrottle : paramChangeThrottle.delay,
          typeof paramChangeThrottle === 'number' ? { leading: false, maxWait: paramChangeThrottle, trailing: true } : paramChangeThrottle
        );

  function handleParamChange(): void {
    clearActiveRefetchTimeout();

    if (throttledParamChange) {
      const state = queryStore.getState();
      const shouldReplaceInitialFetch = keepPreviousData && activeFetch?.key === state.queryKey && state.lastFetchedAt === null;
      if (shouldReplaceInitialFetch) applyParamChange();
      else throttledParamChange();
      return;
    }
    applyParamChange();
  }

  paramUnsubscribes.push(
    queryParams.subscribe((key, oldValue, newValue) => {
      if (enableLogs) console.log('[🌀 Param Change 🌀] -', key, '- [Old]:', `${oldValue?.toString()},`, '[New]:', newValue?.toString());
      handleParamChange();
    })
  );

  if (trackedStaleTime) {
    let oldVal = trackedStaleTime.initialValue;
    if (enableLogs) console.log('[🌀 StaleTime Subscription 🌀] Initial value:', oldVal);

    paramUnsubscribes.push(
      trackedStaleTime.subscribe(newVal => {
        if (newVal !== oldVal) {
          if (enableLogs) console.log('[🌀 StaleTime Change 🌀] - [Old]:', `${oldVal},`, '[New]:', newVal);
          oldVal = newVal;
          staleTime = newVal;
          clearActiveRefetchTimeout();
          queryStoreFetch(undefined, undefined, true);
        }
      })
    );
  }

  let initialStatePatch: Partial<QueryStoreInternalState<TData, TParams>> | undefined;

  if (trackedEnabled) {
    let oldVal = trackedEnabled.initialValue;
    if (initialStoreEnabled !== oldVal) (initialStatePatch ??= {}).enabled = oldVal;
    if (enableLogs) console.log('[🌀 Enabled Subscription 🌀] Initial value:', oldVal);

    paramUnsubscribes.push(
      trackedEnabled.subscribe(newVal => {
        if (newVal !== oldVal) {
          if (enableLogs) console.log('[🌀 Enabled Change 🌀] - [Old]:', `${oldVal},`, '[New]:', newVal);
          oldVal = newVal;
          queryStore.setState({ enabled: newVal });
        }
      })
    );
  } else if (initialStoreEnabled !== initialData.enabled) {
    (initialStatePatch ??= {}).enabled = initialData.enabled;
  }

  const resolvedQueryKey = queryParams.buildKey();
  if (resolvedQueryKey !== queryKey) (initialStatePatch ??= {}).queryKey = resolvedQueryKey;
  if (initialStatePatch) queryStore.setState(initialStatePatch);

  isBuildingParams = false;

  return assignStoreTag(queryStore, StoreTags.QueryStore);
}

function hasStorageKey<S, PersistedState extends Partial<S>, PersistReturn>(
  options: BaseStoreOptions<S, PersistedState, PersistReturn> | undefined
): options is Extract<BaseStoreOptions<S, PersistedState, PersistReturn>, { storageKey: string }> {
  return typeof options?.storageKey === 'string';
}

// ============ Cache Utilities ================================================ //

function createBlendedPartialize<
  TData,
  TParams extends Record<string, unknown>,
  S extends QueryStoreState<TData, TParams, CustomState>,
  CustomState = unknown,
  PersistedState extends Partial<S> = Partial<S>,
>(keepPreviousData: boolean, userPartialize: PersistConfig<S, PersistedState>['partialize'] | undefined): (state: S) => PersistedState {
  return (state: S): PersistedState => {
    const clonedState = { ...state };
    const internalStateToPersist: Partial<S> = nullObject();

    for (const key in clonedState) {
      if (!hasOwn(clonedState, key)) continue;
      if (key in SHOULD_PERSIST_INTERNAL_STATE_MAP) {
        if (SHOULD_PERSIST_INTERNAL_STATE_MAP[key]) internalStateToPersist[key] = clonedState[key];
        delete clonedState[key];
      }
    }

    return {
      ...(userPartialize ? userPartialize(clonedState) : omitStoreMethods(clonedState)),
      ...pruneCache<S, TData, TParams>(keepPreviousData, null, internalStateToPersist),
    } satisfies PersistedState;
  };
}

function pruneCache<S extends QueryStoreState<TData, TParams>, TData, TParams extends Record<string, unknown>>(
  keepPreviousData: boolean,
  keyToPreserve: string | null,
  state: S | Partial<S>
): S | Partial<S> {
  if (!state.queryCache) return state;
  const pruneTime = Date.now();
  const preserve = keyToPreserve ?? ((keepPreviousData && state.queryKey) || null);
  const newCache: Record<string, CacheEntry<TData>> = nullObject();

  let prunedSomething = false;

  for (const key in state.queryCache) {
    if (!hasOwn(state.queryCache, key)) continue;
    const entry = state.queryCache[key];
    const isValid = !!entry && (pruneTime - (entry.lastFetchedAt ?? entry.errorInfo.lastFailedAt) < entry.cacheTime || key === preserve);

    if (!isValid) {
      prunedSomething = true;
    } else if (!keyToPreserve && entry.errorInfo && entry.errorInfo.retryCount > 0) {
      newCache[key] = { ...entry, errorInfo: { ...entry.errorInfo, retryCount: 0 } } satisfies CacheEntry<TData>;
      prunedSomething = true;
    } else newCache[key] = entry;
  }

  if (!prunedSomething) return state;

  return { ...state, queryCache: newCache };
}

// ============ Internal Helpers =============================================== //

function createEmptyState<CustomState>(): CustomState {
  return Object.create(null);
}

function queryStoreError(storeIdentifier: string, stage: string, cause: unknown): StoresError {
  return new StoresError(`[createQueryStore: ${storeIdentifier}]: ${stage} failed`, cause);
}

function transformQueryData<TQueryFnData, TParams extends Record<string, unknown>, TData, CustomState>(
  rawData: TQueryFnData,
  params: TParams,
  transform: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>['transform']
): TData;
function transformQueryData<TQueryFnData, TParams extends Record<string, unknown>, TData>(
  rawData: TQueryFnData,
  params: TParams,
  transform: QueryStoreConfig<TQueryFnData, TParams, TData>['transform']
): TData | TQueryFnData {
  return transform ? transform(rawData, params) : rawData;
}
