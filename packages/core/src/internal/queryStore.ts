import { IS_DEV, IS_TEST } from '#env';
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
  RetryFailureParams,
} from '../queryStore/types';
import type { BaseStoreOptions, Listener, PersistConfig, StateCreator, Timeout } from '../types';
import type { InternalSubscribeOptions, InternalSubscribeOverloads, InternalUnsubscribeFn } from './internalSubscriptions';
import { wrapCascadeStateSubscription } from './cascadeSubscriptions';
import type { BivariantMethod } from '../types/functions';
import { hasOwn } from '../types/utils';
import { buildNullObject, nullObject } from '../utils/core';
import { debounce } from '../utils/debounce';
import { time } from '../utils/time';
import { baseStore } from './baseStore';
import { markStoreCreated } from './config';
import { StoresError, ensureError } from './errors';
import { logger } from './logger';
import { defaultRetryDelay, getQueryStoreDefaults } from './queryStore/queryStoreDefaults';
import { createQueryParams, trackQueryValue } from './queryStore/queryParams';
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

const FETCH_ABORTED = Symbol();
const CASCADE_PARTICIPANT_TRUE = Object.freeze({ isCascadeParticipant: true });
const FORCE_TRUE = Object.freeze({ force: true });
const ONCE_TRUE = Object.freeze({ once: true });
const QUERY_SUBSCRIPTION_THROTTLE = time.seconds(5);

// ============ Internal Types ================================================= //

type QueryTask = () => void;

type PendingFetch<TData> = {
  key: string;
  promise: Promise<TData | null> | null;
  abortController: AbortController | null;
  updateQueryKey: boolean | undefined;
};

type ResolvedQuery<TParams> = { params: TParams; key: string };

type InternalFetch<TData, TParams extends Record<string, unknown>> = (
  params?: Partial<TParams>,
  options?: FetchOptions,
  isInternalFetch?: boolean,
  retryCount?: number,
  resolved?: ResolvedQuery<TParams>
) => Promise<TData | null>;

type InternalSetState<TData, TParams extends Record<string, unknown>, S extends QueryStoreState<TData, TParams>> = BivariantMethod<{
  set(
    partial: Partial<QueryStoreInternalState<TData, TParams>> | ((state: S) => Partial<QueryStoreInternalState<TData, TParams>>),
    replace?: false
  ): void | Promise<void>;
}>;

type InternalQueryStore<TData, TParams extends Record<string, unknown>, S extends QueryStoreState<TData, TParams>> = ReturnType<
  typeof baseStore<S, Partial<S>, void | Promise<void>>
> & { persist?: { hydrationPromise?: () => Promise<void> }; setState: InternalSetState<TData, TParams, S> };

// ============ Shared Query Task Queue ======================================== //

const queryTaskQueue = new Set<QueryTask>();
let queryTaskFlushScheduled = false;

function scheduleQueryTask(task: QueryTask): void {
  if (queryTaskQueue.has(task)) return;
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
    onError = defaults.onError,
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
    paramChangeThrottle = defaults.paramChangeThrottle,
    params,
    retry = defaults.retry,
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

  const cacheTimeIsFunction = typeof cacheTime === 'function';
  const enableLogs = IS_DEV && debugMode;
  const paramKeys: (keyof TParams)[] = config.params ? Object.keys(config.params) : [];

  // ========== Internal State ==========

  const paramUnsubscribes: InternalUnsubscribeFn[] = [];

  let initialHydration: Promise<void> | undefined;
  let destroyed = false;
  let activeFetch: PendingFetch<TData> | null = null;
  let backgroundFetches: Record<string, PendingFetch<TData>> | undefined;
  let scheduledFetch: { key: string; timeout: Timeout } | null = null;
  let lastFetchKey: string | null = null;

  const initialData = {
    enabled: typeof enabled === 'function' ? false : enabled,
    error: null,
    lastFetchedAt: null,
    queryCache: {},
    queryKey: '',
    status: QueryStatuses.Idle,
  };

  let subscriberCount = 0;
  let lastSubscriptionTime: number | null = null;
  let onQuerySubscribe: () => void;

  function selectFetch(nextFetch: PendingFetch<TData> | null): PendingFetch<TData> | null {
    const previousFetch = activeFetch;
    if (previousFetch?.promise && !previousFetch.abortController) {
      (backgroundFetches ??= nullObject<Record<string, PendingFetch<TData>>>())[previousFetch.key] = previousFetch;
    }
    activeFetch = nextFetch;
    if (nextFetch) delete backgroundFetches?.[nextFetch.key];
    return previousFetch;
  }

  function clearScheduledFetch(): void {
    if (scheduledFetch) {
      clearTimeout(scheduledFetch.timeout);
      scheduledFetch = null;
    }
  }

  // ========== State Creator ==========

  function createState(
    set: InternalSetState<TData, TParams, S> & Parameters<StateCreator<S>>[0],
    get: Parameters<StateCreator<S>>[1],
    api: Parameters<StateCreator<S>>[2]
  ): S {
    const originalSubscribe: InternalSubscribeOverloads<S> = api.subscribe;

    paramUnsubscribes.push(
      originalSubscribe(
        state => state?.enabled ?? initialData.enabled,
        enabled => {
          if (enabled && subscriberCount > 0) queueMicrotask(() => baseMethods.fetch(undefined, undefined, true));
          else if (!enabled) {
            activeFetch?.abortController?.abort();
            clearScheduledFetch();
          }
        },
        CASCADE_PARTICIPANT_TRUE
      )
    );

    onQuerySubscribe = () => {
      const isFirstSubscription = subscriberCount === 0;

      subscriberCount += 1;
      if (!destroyed) {
        const state = get();

        if (state.enabled) {
          if (isFirstSubscription) {
            const currentParams = queryParams.get();
            const currentQueryKey = queryParams.buildKey(currentParams);
            if (state.queryKey !== currentQueryKey) set({ queryKey: currentQueryKey });

            baseMethods.fetch(currentParams, undefined, true, undefined, { params: currentParams, key: currentQueryKey });
          } else if (
            disableAutoRefetching &&
            (lastSubscriptionTime === null || Date.now() - lastSubscriptionTime > QUERY_SUBSCRIPTION_THROTTLE)
          ) {
            baseMethods.fetch(undefined, undefined, true);
          }
        }
      }

      if (disableAutoRefetching) lastSubscriptionTime = Date.now();
    };

    function scheduleNextFetch(params: TParams, queryKey: string): void {
      if (disableAutoRefetching || staleTime <= 0 || staleTime === Infinity) return;
      if (subscriberCount === 0) return;

      clearScheduledFetch();
      const state = get();
      if (!state.enabled) return;

      const lastFetchedAt =
        (disableCache ? lastFetchKey === queryKey && state.lastFetchedAt : state.queryCache[queryKey]?.lastFetchedAt) || null;
      const timeUntilRefetch = lastFetchedAt ? staleTime - (Date.now() - lastFetchedAt) : staleTime;

      scheduledFetch = {
        key: queryKey,
        timeout: setTimeout(() => {
          if (get().enabled) baseMethods.fetch(params, FORCE_TRUE, true);
        }, timeUntilRefetch),
      };
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
          const cacheEntry = disableCache ? undefined : state.queryCache[queryKey];
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

    function fetch(
      params: TParams | Partial<TParams> | undefined,
      options: FetchOptions | undefined,
      isInternalFetch = false,
      retryCount = 0,
      resolved?: ResolvedQuery<TParams>
    ): Promise<TData | null> {
      try {
        if (destroyed) return Promise.resolve(null);

        const skipStoreUpdates = options?.skipStoreUpdates;
        const isResultOnly = skipStoreUpdates === true || (skipStoreUpdates === 'withCache' && disableCache && !setData);
        const state = get();

        if (!skipStoreUpdates && ((!state.enabled && !options?.force) || (isInternalFetch && subscriberCount === 0))) {
          return Promise.resolve(null);
        }

        const effectiveParams = resolved?.params ?? queryParams.complete(params);
        const fetchQueryKey = resolved?.key ?? queryParams.buildKey(effectiveParams);
        const hydration = initialHydration;

        if (hydration && !isResultOnly) {
          const resume = fetch.bind(undefined, params, options, isInternalFetch, retryCount, {
            params: effectiveParams,
            key: fetchQueryKey,
          });
          return hydration.then(resume);
        }

        const shouldUpdateQueryKey = options?.updateQueryKey ?? (isInternalFetch && keepPreviousData);
        const isMainFetchPath = !skipStoreUpdates && (isInternalFetch || shouldUpdateQueryKey || state.queryKey === fetchQueryKey);

        let pendingFetch = skipStoreUpdates
          ? null
          : activeFetch?.key === fetchQueryKey
            ? activeFetch
            : (backgroundFetches?.[fetchQueryKey] ?? null);

        let promise = pendingFetch?.promise;
        let startFetch: (() => void) | undefined;
        let rejectFetch: ((error: unknown) => void) | undefined;

        if (!promise) {
          if (!options?.force) {
            /* Check for valid cached data */
            const effectiveStaleTime = options?.staleTime ?? staleTime;
            const cacheEntry = disableCache ? undefined : state.queryCache[fetchQueryKey];
            const errorInfo = cacheEntry?.errorInfo;
            const lastFetchedAt =
              (disableCache ? lastFetchKey === fetchQueryKey && state.lastFetchedAt : cacheEntry?.lastFetchedAt) || null;

            const isStale = !lastFetchedAt || Date.now() - lastFetchedAt >= effectiveStaleTime;

            if (!isStale && (!errorInfo || !errorInfo.retryAllowed || skipStoreUpdates)) {
              if (isMainFetchPath) {
                const previousFetch = selectFetch(null);
                if (scheduledFetch?.key !== fetchQueryKey) clearScheduledFetch();
                if (!scheduledFetch) scheduleNextFetch(effectiveParams, fetchQueryKey);

                try {
                  const error = disableCache && state.queryKey === fetchQueryKey ? state.error : (errorInfo?.error ?? null);
                  const queryKey = shouldUpdateQueryKey ? fetchQueryKey : state.queryKey;
                  const status = error ? QueryStatuses.Error : QueryStatuses.Success;

                  if (
                    state.error !== error ||
                    state.lastFetchedAt !== lastFetchedAt ||
                    state.queryKey !== queryKey ||
                    state.status !== status
                  ) {
                    set({ error, lastFetchedAt, queryKey, status });
                  }
                } finally {
                  previousFetch?.abortController?.abort();
                }

                if (destroyed) return Promise.resolve(null);
              }

              if (enableLogs) console.log('[💾 Returning Cached Data 💾] for params:', JSON.stringify(effectiveParams));
              return Promise.resolve(cacheEntry?.data ?? null);
            }
          }

          const effectiveCacheTime = options?.cacheTime ?? (cacheTimeIsFunction ? cacheTime(effectiveParams) : cacheTime);
          const storeIdentifier = storeOptions?.storageKey || fetchQueryKey;
          const abortController = abortInterruptedFetches && isMainFetchPath ? new AbortController() : null;
          const request: PendingFetch<TData> = { key: fetchQueryKey, promise: null, abortController, updateQueryKey: undefined };

          pendingFetch = request;

          let response: Promise<TQueryFnData>;
          if (skipStoreUpdates) {
            try {
              if (enableLogs) logFetch(params, effectiveParams, isInternalFetch, paramKeys);
              response = Promise.resolve(fetcher(effectiveParams, null));
            } catch (error) {
              response = Promise.reject(error);
            }
          } else {
            // Prepare completion before publishing the loading state.
            response = new Promise<TQueryFnData>((resolve, reject) => {
              function rejectResponse(error: unknown): void {
                if (error === FETCH_ABORTED) {
                  if (backgroundFetches?.[fetchQueryKey] === request) delete backgroundFetches[fetchQueryKey];
                  if (activeFetch === request) activeFetch = null;
                }
                request.abortController = null;
                reject(error);
              }

              rejectFetch = rejectResponse;
              abortController?.signal.addEventListener('abort', () => rejectResponse(FETCH_ABORTED), ONCE_TRUE);

              startFetch = () => {
                if (abortController?.signal.aborted) return;
                try {
                  if (enableLogs) logFetch(params, effectiveParams, isInternalFetch, paramKeys);

                  Promise.resolve(fetcher(effectiveParams, abortController)).then(result => {
                    request.abortController = null;
                    resolve(result);
                  }, rejectResponse);
                } catch (error) {
                  rejectResponse(error);
                }
              };
            });
          }

          const handleResponse = (rawResult: TQueryFnData): TData | null => {
            try {
              if (!isResultOnly && destroyed) return null;

              const lastFetchedAt = Date.now();
              let transformedData: TData;

              if (enableLogs) console.log('[✅ Fetch Successful ✅] for params:', JSON.stringify(effectiveParams));

              try {
                transformedData = transformQueryData(rawResult, effectiveParams, transform);
              } catch (transformError) {
                throw queryStoreError(storeIdentifier, 'transform', transformError);
              }

              if (isResultOnly) return transformedData;

              const state = get();
              const isCurrentFetch = activeFetch === request;
              let update: Partial<QueryStoreInternalState<TData, TParams>> = isCurrentFetch
                ? {
                    error: null,
                    lastFetchedAt,
                    queryKey: request.updateQueryKey ? fetchQueryKey : state.queryKey,
                    status: QueryStatuses.Success,
                  }
                : {};

              if (setData) {
                let composedState: S = skipStoreUpdates && disableCache ? state : { ...state, ...update };

                try {
                  setData({
                    data: transformedData,
                    params: effectiveParams,
                    queryKey: fetchQueryKey,
                    set: partial => {
                      composedState = { ...composedState, ...(typeof partial === 'function' ? partial(composedState) : partial) };
                    },
                  });
                } catch (setDataError) {
                  throw queryStoreError(storeIdentifier, 'setData', setDataError);
                }

                update = composedState;
              }

              const queryCache = update.queryCache ?? state.queryCache;
              if (!disableCache && (!setData || Object.is(state.queryCache[fetchQueryKey], queryCache[fetchQueryKey]))) {
                update.queryCache = {
                  ...queryCache,
                  [fetchQueryKey]: {
                    cacheTime: effectiveCacheTime,
                    data: setData ? null : transformedData,
                    errorInfo: null,
                    lastFetchedAt,
                  } satisfies CacheEntry<TData>,
                };
              }

              if (isCurrentFetch) lastFetchKey = fetchQueryKey;
              request.promise = null;

              if (!skipStoreUpdates && !disableCache && cacheTime !== Infinity) {
                update.queryCache = pruneCache(
                  update.queryCache ?? queryCache,
                  fetchQueryKey,
                  keepPreviousData ? (update.queryKey ?? state.queryKey) : undefined
                );
              }

              if (setData || !disableCache || isCurrentFetch) set(update);

              if (destroyed) return null;
              if (skipStoreUpdates) return transformedData;
              if (activeFetch === request) scheduleNextFetch(effectiveParams, fetchQueryKey);

              if (onFetched) {
                try {
                  onFetched({ data: transformedData, fetch: baseMethods.fetch, params: effectiveParams, set });
                } catch (onFetchedError) {
                  logger.error(queryStoreError(storeIdentifier, 'onFetched callback', onFetchedError));
                }
              }

              return transformedData ?? null;
            } catch (error) {
              return handleFailure(error);
            } finally {
              if (activeFetch === request) activeFetch = null;
              if (backgroundFetches?.[fetchQueryKey] === request) delete backgroundFetches[fetchQueryKey];
            }
          };

          const handleFailure = (error: unknown): null => {
            try {
              if (error === FETCH_ABORTED) {
                if (enableLogs) console.log('[❌ Fetch Aborted ❌] for params:', JSON.stringify(effectiveParams));
                return null;
              }

              if (!isResultOnly && destroyed) return null;

              const typedError = ensureError(error);
              if (typedError instanceof StoresError) logger.error(typedError);
              if (request.updateQueryKey === undefined) throw typedError;

              const lastFailedAt = Date.now();
              let failure: RetryFailureParams<TParams> | undefined;
              let retryAllowed: boolean;

              if (typeof retry === 'function') {
                failure = { error: typedError, params: effectiveParams, queryKey: fetchQueryKey, retryCount };
                try {
                  retryAllowed = retry(failure);
                } catch (retryError) {
                  logger.error(queryStoreError(storeIdentifier, 'retry callback', retryError));
                  retryAllowed = false;
                }
              } else {
                retryAllowed = retry !== false && retryCount < retry;
              }

              let retryAfter: number | undefined;

              if (retryAllowed && activeFetch === request && get().enabled && subscriberCount > 0) {
                if (retryDelay === undefined) retryAfter = defaultRetryDelay(retryCount);
                else if (typeof retryDelay === 'number') retryAfter = retryDelay;
                else {
                  failure ??= { error: typedError, params: effectiveParams, queryKey: fetchQueryKey, retryCount };
                  try {
                    retryAfter = retryDelay(failure);
                  } catch (retryDelayError) {
                    logger.error(queryStoreError(storeIdentifier, 'retryDelay callback', retryDelayError));
                    retryAllowed = false;
                  }
                }
              }

              const state = get();
              const update: Partial<QueryStoreInternalState<TData, TParams>> =
                activeFetch === request
                  ? {
                      error: typedError,
                      queryKey: request.updateQueryKey ? fetchQueryKey : state.queryKey,
                      status: QueryStatuses.Error,
                    }
                  : {};

              if (!disableCache) {
                const entry = state.queryCache[fetchQueryKey];
                update.queryCache = {
                  ...state.queryCache,
                  [fetchQueryKey]: {
                    cacheTime: entry?.cacheTime ?? effectiveCacheTime,
                    data: entry?.data ?? null,
                    lastFetchedAt: entry?.lastFetchedAt ?? null,
                    errorInfo: { error: typedError, lastFailedAt, retryAllowed, retryCount },
                  } satisfies CacheEntry<TData>,
                };
              }

              request.promise = null;
              set(update);

              if (destroyed) return null;
              if (activeFetch !== request || !get().enabled || subscriberCount === 0) retryAfter = undefined;
              if (retryAfter !== undefined) {
                clearScheduledFetch();
                scheduledFetch = {
                  key: fetchQueryKey,
                  timeout: setTimeout(() => {
                    if (get().enabled) baseMethods.fetch(effectiveParams, FORCE_TRUE, true, retryCount + 1);
                  }, retryAfter),
                };
              }

              if (onError) {
                try {
                  onError({
                    error: typedError,
                    params: effectiveParams,
                    queryKey: fetchQueryKey,
                    retryCount,
                    willRetry: retryAfter !== undefined,
                  });
                } catch (onErrorError) {
                  logger.error(queryStoreError(storeIdentifier, 'onError callback', onErrorError));
                }
              }

              throw typedError;
            } finally {
              if (activeFetch === request) activeFetch = null;
              if (backgroundFetches?.[fetchQueryKey] === request) delete backgroundFetches[fetchQueryKey];
            }
          };

          promise = response.then(handleResponse, handleFailure);
          request.promise = promise;

          if (!skipStoreUpdates && !isMainFetchPath) {
            (backgroundFetches ??= nullObject<Record<string, PendingFetch<TData>>>())[fetchQueryKey] = request;
          }
        } else if (enableLogs) {
          console.log('[🔄 Using Active Fetch 🔄] for params:', JSON.stringify(effectiveParams));
        }

        if (isMainFetchPath && pendingFetch && activeFetch !== pendingFetch) {
          const previousFetch = selectFetch(pendingFetch);
          pendingFetch.updateQueryKey = shouldUpdateQueryKey;
          clearScheduledFetch();

          try {
            const queryKey = shouldUpdateQueryKey && !previousFetch && state.lastFetchedAt === null ? fetchQueryKey : state.queryKey;
            if (state.error !== null || state.queryKey !== queryKey || state.status !== QueryStatuses.Loading) {
              set({ error: null, queryKey, status: QueryStatuses.Loading });
            }
          } catch (error) {
            if (activeFetch === pendingFetch) selectFetch(null);
            rejectFetch?.(FETCH_ABORTED);
            throw error;
          } finally {
            previousFetch?.abortController?.abort();
          }
        }

        if (destroyed) rejectFetch?.(FETCH_ABORTED);
        else startFetch?.();

        startFetch = undefined;
        rejectFetch = undefined;

        return isInternalFetch || !options?.throwOnError ? promise.catch(returnNull) : promise;
      } catch (error) {
        return Promise.reject(error);
      }
    }

    const baseMethods = {
      ...customStateCreator(set, get, api),
      ...initialData,

      fetch,

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
        const currentQueryKey = state.queryKey;
        const cacheEntry = disableCache ? undefined : state.queryCache[currentQueryKey];
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
        if (destroyed) return;
        destroyed = true;
        for (const unsub of paramUnsubscribes) unsub();
        paramUnsubscribes.length = 0;

        activeFetch?.abortController?.abort();
        clearScheduledFetch();
        throttledParamChange?.cancel();

        activeFetch = null;
        backgroundFetches = undefined;
        lastFetchKey = null;

        if (resetStoreState) set(initialData);
      },
    };

    return baseMethods;
  }

  // ========== Store Initialization ==========

  const queryStore: InternalQueryStore<TData, TParams, S> = storeOptions?.storageKey
    ? baseStore<S, PersistedState, PersistReturn>(
        createState,
        buildNullObject<BaseStoreOptions<S, PersistedState, PersistReturn>, { partialize: (state: S) => PersistedState }>(storeOptions, {
          partialize: createBlendedPartialize<TData, TParams, S, CustomState, PersistedState>(keepPreviousData, storeOptions.partialize),
        })
      )
    : options && !('storageKey' in options)
      ? baseStore<S, PersistedState, PersistReturn>(createState, options)
      : baseStore<S, PersistedState, PersistReturn>(createState);

  if (queryStore.persist?.hydrationPromise) {
    function finishHydration(): void {
      initialHydration = undefined;
      if (destroyed) return;
      const queryKey = queryParams.buildKey();
      if (queryStore.getState().queryKey !== queryKey) queryStore.setState({ queryKey });
    }
    initialHydration = queryStore.persist.hydrationPromise().then(finishHydration, finishHydration);
  }

  const initialState = queryStore.getState();
  const error = initialState.error;
  const initialStoreEnabled = initialState.enabled;
  const queryKey = initialState.queryKey;
  const queryStoreFetch: InternalFetch<TData, TParams> = initialState.fetch;

  if (queryKey && !error) lastFetchKey = queryKey;

  // ========== Params ==========

  const queryParams = createQueryParams<TParams, S>(params, queryStore, paramKeys);
  const trackedEnabled = typeof enabled === 'function' ? trackQueryValue(enabled, queryStore) : undefined;
  const trackedStaleTime = typeof config.staleTime === 'function' ? trackQueryValue(config.staleTime, queryStore) : undefined;

  if (trackedStaleTime) staleTime = trackedStaleTime.initialValue;

  let pendingQuery: ResolvedQuery<TParams> | undefined;

  function flushParamFetch(): void {
    const query = pendingQuery;
    pendingQuery = undefined;
    void queryStoreFetch(query?.params, undefined, true, undefined, query);
  }

  function applyParamChange(): void {
    const params = keepPreviousData ? undefined : queryParams.get();
    const query = params ? { params, key: queryParams.buildKey(params) } : undefined;
    if (query) queryStore.setState({ queryKey: query.key });
    pendingQuery = query;
    scheduleQueryTask(flushParamFetch);
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
    clearScheduledFetch();

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
    if (enableLogs) console.log('[🌀 StaleTime Subscription 🌀] Initial value:', staleTime);
    paramUnsubscribes.push(
      trackedStaleTime.subscribe(newVal => {
        if (newVal !== staleTime) {
          if (enableLogs) console.log('[🌀 StaleTime Change 🌀] - [Old]:', `${staleTime},`, '[New]:', newVal);
          staleTime = newVal;
          clearScheduledFetch();
          queryStoreFetch(undefined, undefined, true);
        }
      })
    );
  }

  let initialStatePatch: Partial<QueryStoreInternalState<TData, TParams>> | undefined;

  if (trackedEnabled) {
    let oldVal = trackedEnabled.initialValue;
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
    if (queryStore.getState().enabled !== oldVal) (initialStatePatch ??= {}).enabled = oldVal;
  } else if (initialStoreEnabled !== initialData.enabled) {
    (initialStatePatch ??= {}).enabled = initialData.enabled;
  }

  const resolvedQueryKey = queryParams.buildKey();
  if (resolvedQueryKey !== queryKey) (initialStatePatch ??= {}).queryKey = resolvedQueryKey;
  if (initialStatePatch) queryStore.setState(initialStatePatch);

  // ========== Subscribe Override ==========

  function onQueryUnsubscribe(skipAbortFetch?: boolean): void {
    if (--subscriberCount !== 0) return;
    clearScheduledFetch();
    if (!skipAbortFetch) activeFetch?.abortController?.abort();
    lastSubscriptionTime = null;
  }

  function wrapQuerySubscribe(subscribe: InternalSubscribeOverloads<S>): InternalSubscribeOverloads<S> {
    return (
      selectorOrListener: BivariantMethod<{ callback(state: S, previousState: S): unknown }>,
      listener?: Listener<unknown>,
      options?: InternalSubscribeOptions<unknown>
    ) => {
      let unsubscribe: InternalUnsubscribeFn | undefined;

      try {
        onQuerySubscribe();
        if (listener) {
          const selector: BivariantMethod<{ select(state: S, previousState?: S): unknown }> = selectorOrListener;
          unsubscribe = subscribe(selector, listener, options);
        } else unsubscribe = subscribe(selectorOrListener);
      } catch (error) {
        onQueryUnsubscribe();
        throw error;
      }

      return (skipAbortFetch?: boolean) => {
        if (!unsubscribe) return;
        const remove = unsubscribe;
        unsubscribe = undefined;
        onQueryUnsubscribe(skipAbortFetch);
        remove(skipAbortFetch);
      };
    };
  }

  queryStore.subscribe = wrapQuerySubscribe(queryStore.subscribe);
  wrapCascadeStateSubscription(queryStore, wrapQuerySubscribe);

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

    const persistedCustomState: PersistedState = userPartialize ? userPartialize(clonedState) : omitStoreMethods(clonedState);

    if (internalStateToPersist.queryCache) {
      internalStateToPersist.queryCache = pruneCache(
        internalStateToPersist.queryCache,
        null,
        keepPreviousData ? internalStateToPersist.queryKey : undefined
      );
    }

    return { ...persistedCustomState, ...internalStateToPersist } satisfies PersistedState;
  };
}

function pruneCache<TData>(
  queryCache: Record<string, CacheEntry<TData> | undefined>,
  keyToPreserve: string | null,
  previousKey: string | undefined
): Record<string, CacheEntry<TData> | undefined> {
  const pruneTime = Date.now();
  let prunedCache: typeof queryCache | undefined;

  for (const key in queryCache) {
    if (!hasOwn(queryCache, key)) continue;
    const entry = queryCache[key];

    if (
      entry &&
      (pruneTime - (entry.lastFetchedAt ?? entry.errorInfo.lastFailedAt) < entry.cacheTime || key === keyToPreserve || key === previousKey)
    ) {
      if (prunedCache) prunedCache[key] = entry;
      continue;
    }

    if (prunedCache) continue;
    prunedCache = nullObject<typeof queryCache>();

    for (const retainedKey in queryCache) {
      if (retainedKey === key) break;
      if (hasOwn(queryCache, retainedKey)) prunedCache[retainedKey] = queryCache[retainedKey];
    }
  }

  return prunedCache ?? queryCache;
}

// ============ Internal Helpers =============================================== //

function logFetch(
  params: Record<string, unknown> | undefined,
  effectiveParams: Record<string, unknown>,
  isInternalFetch: boolean,
  paramKeys: readonly PropertyKey[]
): void {
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

function createEmptyState<CustomState>(): CustomState {
  return Object.create(null);
}

function returnNull(): null {
  return null;
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
