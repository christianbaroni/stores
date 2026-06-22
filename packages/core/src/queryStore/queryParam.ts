import type { StoreApi } from '../store/types';
import type { DeriveGetter } from '../types';
import type { NonFunction } from '../types/functions';

// ============ Constants ====================================================== //

const QUERY_PARAM_CONFIG = Symbol('stores.queryParamConfig');

// ============ Types ========================================================== //

/**
 * Selects how a query parameter participates in the query key.
 */
export type QueryParamKey<T> = false | ((value: T) => unknown);

/**
 * A query value derived from stores via `$`.
 */
export type ReactiveParam<T, State> = ($: DeriveGetter, store: StoreApi<State>) => T;

/**
 * Query parameter wrapper for values whose fetcher value and key value differ.
 */
export type QueryParamConfig<T, State> = {
  readonly [QUERY_PARAM_CONFIG]: true;
  readonly key: QueryParamKey<T>;
  readonly value: NonFunction<T> | ReactiveParam<T, State>;
};

/**
 * A direct, reactive, or key-configured query parameter.
 */
export type QueryParam<T, State> = NonFunction<T> | ReactiveParam<T, State> | QueryParamConfig<T, State>;

// ============ Public API ===================================================== //

/**
 * Wraps a query parameter when its full fetcher value should be excluded
 * from the query key or represented by a smaller key value.
 */
export function queryParam<T, State>(
  value: NonFunction<T> | ReactiveParam<T, State>,
  options: { key: QueryParamKey<T> }
): QueryParamConfig<T, State> {
  return { [QUERY_PARAM_CONFIG]: true, key: options.key, value };
}

// ============ Type Guards ==================================================== //

/**
 * Checks if a `QueryParam` value is a custom `queryParam(...)` config.
 */
export function isQueryParamConfig<T, State>(value: QueryParam<T, State>): value is QueryParamConfig<T, State> {
  return !!value && typeof value === 'object' && QUERY_PARAM_CONFIG in value;
}
