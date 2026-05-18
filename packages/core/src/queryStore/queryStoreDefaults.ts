import { QueryStoreDefaults, getOptions } from '../config';
import { Prettify } from '../types/objects';
import { time } from '../utils/time';

type RequiredDefaults = Prettify<Required<QueryStoreDefaults>>;

let resolvedDefaults: RequiredDefaults | undefined;

export function getQueryStoreDefaults(): Prettify<Required<QueryStoreDefaults>> {
  return (resolvedDefaults ??= buildQueryDefaults());
}

function buildQueryDefaults(): RequiredDefaults {
  const systemDefaults: Required<QueryStoreDefaults> = {
    abortInterruptedFetches: true,
    cacheTime: time.days(7),
    debugMode: false,
    disableAutoRefetching: false,
    keepPreviousData: false,
    maxRetries: 5,
    minStaleTime: false,
    paramChangeThrottle: false,
    retryDelay: defaultRetryDelay,
    staleTime: time.minutes(2),
    suppressStaleTimeWarning: false,
  };
  const userDefaults = getOptions()?.queryStoreDefaults;
  return userDefaults ? { ...systemDefaults, ...userDefaults } : systemDefaults;
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
