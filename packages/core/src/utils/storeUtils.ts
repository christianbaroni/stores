import type { QueryStore, QueryStoreState } from '../queryStore/types';
import type { StoreApi } from '../store/types';
import type { BaseStore, InferStoreState, PersistedStore } from '../types';

/** @internal */
export const StoreTags = Object.freeze({
  QueryStore: Symbol('queryStore'),
  VirtualStore: Symbol('virtualStore'),
});

type StoreTag = (typeof StoreTags)[keyof typeof StoreTags];

/** @internal */
export function assignStoreTag<Store extends object>(store: Store, tag: StoreTag): Store {
  return Object.assign(store, { [tag]: true });
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
  const fallbackName = getCallableName(store);
  return isPersistedStore(store) ? (store.persist.getOptions().name ?? fallbackName) : fallbackName;
}

function getCallableName(value: unknown): string {
  return typeof value === 'function' ? value.name : '';
}

/**
 * Checks if a store has a `destroy` method.
 *
 * @internal
 */
export function hasDestroy<T extends StoreApi<unknown>>(store: T): store is T & { destroy: () => void } {
  return 'destroy' in store;
}

/**
 * Checks if a store is a `DerivedStore` and reveals its internal `getSnapshot` method.
 */
export function hasGetSnapshot<T extends BaseStore<unknown> | StoreApi<unknown>>(
  store: T
): store is T & { getSnapshot: () => InferStoreState<T> } {
  return 'getSnapshot' in store;
}

/**
 * Checks if a store is a `QueryStore`.
 */
export function isQueryStore<T extends object>(
  store: T
): store is Extract<T, BaseStore<QueryStoreState<unknown, Record<string, unknown>, unknown>>> {
  return StoreTags.QueryStore in store;
}

/**
 * Checks if a store is a `DerivedStore`.
 */
export function isDerivedStore<T extends BaseStore<unknown> | StoreApi<unknown>>(
  store: T
): store is T & { destroy: () => void; flushUpdates: () => void } {
  return 'flushUpdates' in store;
}

/**
 * Checks if a store is persisted.
 */
export function isPersistedStore<T extends BaseStore<unknown> | PersistedStore<unknown>>(
  store: T
): store is T & { persist: PersistedStore<InferStoreState<T>>['persist'] } {
  if (!('persist' in store) || !store.persist) return false;
  return typeof store.persist.getOptions().name === 'string';
}

/**
 * Checks if a store is a virtual store.
 */
export function isVirtualStore<T extends BaseStore<unknown> | StoreApi<unknown>>(store: T): store is T & BaseStore<InferStoreState<T>> {
  return StoreTags.VirtualStore in store;
}
