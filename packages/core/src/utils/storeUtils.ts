import { StoreApi } from 'zustand';
import { BaseStore, DerivedStore, PersistedStore, SetFull, SetPartial, SetStateArgs, WithGetSnapshot } from '../types';
import { QueryStore, QueryStoreState } from 'src/queryStore/types';

export enum StoreTags {
  QueryStore = '_queryStore',
  VirtualStore = '_virtualStore',
}

export function assignStoreTag<S>(store: BaseStore<S>, tag: StoreTags): BaseStore<S> {
  return Object.assign(store, { [tag]: true });
}

/**
 * Helper that applies a `setState` update to the provided state.
 * Handles the `setState` discriminated union types internally.
 */
export function applyStateUpdate<S>(state: S, ...setArgs: SetStateArgs<S>): S {
  if (setArgs[1] === true) {
    return isFunctionSetter(setArgs[0]) ? setArgs[0](state) : setArgs[0];
  } else {
    return { ...state, ...(isFunctionSetter(setArgs[0]) ? setArgs[0](state) : setArgs[0]) };
  }
}

/**
 * Calls the appropriate reset or destroy method on the store, if available.
 * Handles both `DerivedStore` and `QueryStore`.
 */
export function destroyStore(
  store: BaseStore<unknown> | StoreApi<unknown> | QueryStore<unknown, Record<string, unknown>, unknown>,
  options?: { clearQueryCache?: boolean }
): void {
  if (isQueryStore(store)) store.getState().reset(options?.clearQueryCache);
  else if (hasDestroy(store)) store.destroy();
}

export function destroyStores(
  stores: Partial<Record<string, BaseStore<unknown> | StoreApi<unknown>>> | (BaseStore<unknown> | StoreApi<unknown> | undefined)[],
  options?: {
    clearQueryCache?: boolean;
    skipDestroy?: (store: BaseStore<unknown> | StoreApi<unknown>) => boolean;
  }
): void {
  for (const store of Array.isArray(stores) ? stores : Object.values(stores)) {
    if (!store || options?.skipDestroy?.(store)) continue;
    destroyStore(store, options);
  }
}

/**
 * Returns the name of the store, either from the `persist` options or the store itself.
 */
export function getStoreName(store: BaseStore<unknown>): string {
  return isPersistedStore(store) ? (store.persist.getOptions().name ?? store.name) : store.name;
}

/**
 * Checks if a store has a `destroy` method.
 */
export function hasDestroy<S>(store: StoreApi<S>): store is StoreApi<S> & { destroy: () => void } {
  return 'destroy' in store;
}

/**
 * Checks if a store is a `DerivedStore` and reveals its internal `getSnapshot` method.
 */
export function hasGetSnapshot<S>(store: BaseStore<S> | StoreApi<S>): store is WithGetSnapshot<DerivedStore<S>> {
  return 'getSnapshot' in store;
}

/**
 * Checks if a store is a `QueryStore`.
 */
export function isQueryStore<S>(
  store: StoreApi<S> | BaseStore<S> | QueryStore<S, Record<string, unknown>, S>
): store is BaseStore<QueryStoreState<S, Record<string, unknown>, S>> {
  return StoreTags.QueryStore in store;
}

/**
 * Checks if a store is a `DerivedStore`.
 */
export function isDerivedStore<S>(store: BaseStore<S> | StoreApi<S>): store is DerivedStore<S> {
  return 'flushUpdates' in store;
}

/**
 * Checks if a store is persisted.
 */
export function isPersistedStore<S>(store: BaseStore<S>): store is PersistedStore<S> {
  return 'persist' in store;
}

/**
 * Checks if a store is a virtual store.
 */
export function isVirtualStore<S>(store: BaseStore<S> | StoreApi<S>): store is BaseStore<S> & { [StoreTags.VirtualStore]: true } {
  return StoreTags.VirtualStore in store;
}

/**
 * Checks if a `setState` payload is a function setter.
 */
function isFunctionSetter<S>(update: SetPartial<S>): update is (state: S) => Partial<S>;
function isFunctionSetter<S>(update: SetFull<S>): update is (state: S) => S;
function isFunctionSetter<S>(update: SetPartial<S> | SetFull<S>): update is (state: S) => S | Partial<S> {
  return typeof update === 'function';
}
