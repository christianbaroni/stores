import { useSyncExternalStoreWithSelector } from '../hooks/useSyncExternalStoreWithSelector';
import type { EqualityFn, Selector, SubscribeOverloads, UseStoreCallSignatures } from '../types';

export function attachStoreHook<State, Store extends { subscribe: SubscribeOverloads<State> }>(
  store: Store,
  getSnapshot: () => State,
  getServerSnapshot?: () => State,
  defaultEqualityFn?: EqualityFn
): UseStoreCallSignatures<State> & Store {
  function useStore(): State;
  function useStore<Selected>(selector: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function useStore<Selected>(selector?: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): State | Selected {
    return useSyncExternalStoreWithSelector(store.subscribe, getSnapshot, getServerSnapshot, selector, equalityFn ?? defaultEqualityFn);
  }

  return Object.assign(useStore, store);
}
