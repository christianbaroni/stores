import { time } from '../../utils/time';
import { QueryStoreDefaults, getOptions } from '../config';

type OptionalDefaults = 'onError' | 'retryDelay';
type ResolvedDefaults = Required<Omit<QueryStoreDefaults, OptionalDefaults>> & Pick<QueryStoreDefaults, OptionalDefaults>;

let resolvedDefaults: ResolvedDefaults | undefined;

export function getQueryStoreDefaults(): ResolvedDefaults {
  return (resolvedDefaults ??= buildQueryDefaults());
}

function buildQueryDefaults(): ResolvedDefaults {
  const userDefaults = getOptions()?.queryStoreDefaults;
  return {
    abortInterruptedFetches: userDefaults?.abortInterruptedFetches ?? true,
    cacheTime: userDefaults?.cacheTime ?? time.days(7),
    debugMode: userDefaults?.debugMode ?? false,
    disableAutoRefetching: userDefaults?.disableAutoRefetching ?? false,
    keepPreviousData: userDefaults?.keepPreviousData ?? false,
    minStaleTime: userDefaults?.minStaleTime ?? false,
    onError: userDefaults?.onError,
    paramChangeThrottle: userDefaults?.paramChangeThrottle ?? false,
    retry: userDefaults?.retry ?? 5,
    retryDelay: userDefaults?.retryDelay,
    staleTime: userDefaults?.staleTime ?? time.minutes(2),
    suppressStaleTimeWarning: userDefaults?.suppressStaleTimeWarning ?? false,
  };
}

/**
 * Exponential backoff: starts at `baseDelay` (5s), doubles each retry, capped at `maxDelay` (5m).
 */
export function defaultRetryDelay(retryCount: number): number;
export function defaultRetryDelay(retryCount: number, options?: { baseDelay?: number; maxDelay?: number }): number {
  const baseDelay = options?.baseDelay ?? time.seconds(5);
  const maxDelay = options?.maxDelay ?? time.minutes(5);
  return Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
}
