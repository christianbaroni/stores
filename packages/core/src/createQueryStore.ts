import { attachStoreHook } from '@/store/attachStoreHook';
import { defaultRetryDelay, getQueryKey as getQueryKeyValue, parseQueryKey as parseQueryKeyValue, queryStore } from './internal/runtime';
import type { QueryStoreConfig, QueryStoreState } from './queryStore/types';
import type { BaseStoreOptions, OptionallyPersistedStore, PersistedStore, StateCreator, Store } from './types';

export { defaultRetryDelay };

// ============ Query Store Factory ================================================== //

/**
 * Creates a persisted, query-enabled store with data fetching capabilities (sync storage).
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams>> = Partial<QueryStoreState<TData, TParams>>,
  PersistReturn extends void = void,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData>,
  options: BaseStoreOptions<QueryStoreState<TData, TParams>, PersistedState, PersistReturn>
): PersistedStore<QueryStoreState<TData, TParams>, PersistedState, PersistReturn, false>;

/**
 * Creates a persisted, query-enabled store with data fetching capabilities (async storage).
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams>> = Partial<QueryStoreState<TData, TParams>>,
  PersistReturn extends Promise<void> = Promise<void>,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData>,
  options: BaseStoreOptions<QueryStoreState<TData, TParams>, PersistedState, PersistReturn>
): PersistedStore<QueryStoreState<TData, TParams>, PersistedState, PersistReturn, false>;

/**
 * Creates a persisted, query-enabled store with data fetching capabilities (sync storage).
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template CustomState - User-defined custom store state
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  CustomState = unknown,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams, CustomState>> = Partial<QueryStoreState<TData, TParams, CustomState>>,
  PersistReturn extends void = void,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>,
  stateCreator: StateCreator<QueryStoreState<TData, TParams, CustomState>, CustomState>,
  options: BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>
): PersistedStore<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn, false>;

/**
 * Creates a persisted, query-enabled store with data fetching capabilities (async storage).
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template CustomState - User-defined custom store state
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  CustomState = unknown,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams, CustomState>> = Partial<QueryStoreState<TData, TParams, CustomState>>,
  PersistReturn extends Promise<void> = Promise<void>,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>,
  stateCreator: StateCreator<QueryStoreState<TData, TParams, CustomState>, CustomState>,
  options: BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>
): PersistedStore<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn, false>;

/**
 * Creates a query-enabled store with data fetching capabilities.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template CustomState - User-defined custom store state
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  CustomState = unknown,
  TData = TQueryFnData,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>,
  stateCreator: StateCreator<QueryStoreState<TData, TParams, CustomState>, CustomState>,
  options?: BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>>
): Store<QueryStoreState<TData, TParams, CustomState>>;

/**
 * Creates a query-enabled store with data fetching capabilities.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 */
export function createQueryStore<TQueryFnData, TParams extends Record<string, unknown> = Record<string, never>, TData = TQueryFnData>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData>,
  options?: BaseStoreOptions<QueryStoreState<TData, TParams>>
): Store<QueryStoreState<TData, TParams>>;

/**
 * Creates a conditionally persisted, query-enabled store with data-fetching capabilities
 * and custom state (sync storage).
 *
 * `options.persist` may be `undefined` – the returned store exposes `persist?`.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template CustomState - User-defined custom store state
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  CustomState = unknown,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams, CustomState>> = Partial<QueryStoreState<TData, TParams, CustomState>>,
  PersistReturn extends void = void,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>,
  stateCreator: StateCreator<QueryStoreState<TData, TParams, CustomState>, CustomState>,
  options?: BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>
): OptionallyPersistedStore<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>;

/**
 * Creates a conditionally persisted, query-enabled store with data-fetching capabilities
 * and custom state (async storage).
 *
 * `options.persist` may be `undefined` – the returned store exposes `persist?`.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template CustomState - User-defined custom store state
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  CustomState = unknown,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams, CustomState>> = Partial<QueryStoreState<TData, TParams, CustomState>>,
  PersistReturn extends Promise<void> = Promise<void>,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData, CustomState>,
  stateCreator: StateCreator<QueryStoreState<TData, TParams, CustomState>, CustomState>,
  options?: BaseStoreOptions<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>
): OptionallyPersistedStore<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn>;

/**
 * Creates a conditionally persisted, query-enabled store with data fetching capabilities (sync storage).
 *
 * `options.persist` may be `undefined` – the returned store exposes `persist?`.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams>> = Partial<QueryStoreState<TData, TParams>>,
  PersistReturn extends void = void,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData>,
  options: BaseStoreOptions<QueryStoreState<TData, TParams>, PersistedState, PersistReturn> | undefined
): OptionallyPersistedStore<QueryStoreState<TData, TParams>, PersistedState, PersistReturn>;

/**
 * Creates a conditionally persisted, query-enabled store with data fetching capabilities (async storage).
 *
 * `options.persist` may be `undefined` – the returned store exposes `persist?`.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
  TQueryFnData,
  TParams extends Record<string, unknown> = Record<string, never>,
  TData = TQueryFnData,
  PersistedState extends Partial<QueryStoreState<TData, TParams>> = Partial<QueryStoreState<TData, TParams>>,
  PersistReturn extends Promise<void> = Promise<void>,
>(
  config: QueryStoreConfig<TQueryFnData, TParams, TData>,
  options: BaseStoreOptions<QueryStoreState<TData, TParams>, PersistedState, PersistReturn> | undefined
): OptionallyPersistedStore<QueryStoreState<TData, TParams>, PersistedState, PersistReturn>;

/**
 * Creates a query-enabled store with data fetching capabilities.
 *
 * @template TQueryFnData - The raw data type returned by the fetcher
 * @template TParams - Parameters passed to the fetcher function
 * @template CustomState - User-defined custom store state
 * @template TData - The transformed data type, if applicable (defaults to `TQueryFnData`)
 * @template PersistedState - The persisted state type, if a stricter type than `Partial<CustomState>` is desired
 */
export function createQueryStore<
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
):
  | Store<QueryStoreState<TData, TParams, CustomState>>
  | Store<QueryStoreState<TData, TParams, CustomState>, PersistedState, PersistReturn, false> {
  const store = queryStore(config, creatorOrOptions, maybeOptions);
  return attachStoreHook(store, store.getState, store.getInitialState, Object.is);
}

// ============ Public Helpers ================================================= //

/**
 * Generates a deterministic query store `queryKey` from the given parameters,
 * consistent with internally generated keys.
 */
export function getQueryKey<TParams extends Record<string, unknown>>(params: TParams): string {
  return getQueryKeyValue(params);
}

/**
 * Parses a query store `queryKey` into the corresponding parameters.
 */
export function parseQueryKey<TParams extends Record<string, unknown>>(queryKey: string): TParams {
  return parseQueryKeyValue(queryKey);
}
