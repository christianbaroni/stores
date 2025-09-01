import { BaseStore, DerivedStore, PersistedStore } from '../types';

export function getStoreName(store: BaseStore<unknown>): string {
  const name = isPersistedStore(store) ? store.persist.getOptions().name : store.name;
  return name ?? store.name;
}

export function isDerivedStore(store: BaseStore<unknown>): store is DerivedStore<unknown> {
  return 'flushUpdates' in store;
}

export function isPersistedStore(store: BaseStore<unknown>): store is PersistedStore<unknown> {
  return 'persist' in store;
}
