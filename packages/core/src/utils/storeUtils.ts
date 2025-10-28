import { StoreApi } from 'zustand';
import { BaseStore, DerivedStore, PersistedStore, SetFull, SetPartial, SetStateArgs, WithGetSnapshot } from '../types';

/**
 * Helper that applies a `setState` update to the current state.
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
export function destroyStore(store: BaseStore<unknown> | StoreApi<unknown>): void {
  if (hasReset(store)) store.reset();
  else if (hasDestroy(store)) store.destroy();
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
 * Checks if a store has a `reset` method.
 */
export function hasReset<S>(store: BaseStore<S> | StoreApi<S>): store is BaseStore<S> & { reset: () => void } {
  return 'reset' in store;
}

/**
 * Checks if a store is a `DerivedStore`.
 */
export function isDerivedStore<S>(store: BaseStore<S> | StoreApi<S>): store is DerivedStore<S> {
  return 'flushUpdates' in store;
}

/**
 * Checks if a `setState` payload is a function setter.
 */
export function isFunctionSetter<S>(update: SetPartial<S>): update is (state: S) => Partial<S>;
export function isFunctionSetter<S>(update: SetFull<S>): update is (state: S) => S;
export function isFunctionSetter<S>(update: SetPartial<S> | SetFull<S>): update is (state: S) => S | Partial<S> {
  return typeof update === 'function';
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
export function isVirtualStore<S>(store: StoreApi<S>): store is StoreApi<S> & { _isVirtualStore: true } {
  return '_isVirtualStore' in store;
}
