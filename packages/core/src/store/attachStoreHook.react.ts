import { useSyncExternalStoreWithSelector } from '../hooks/useSyncExternalStoreWithSelector';
import type { EqualityFn, Selector, UseStoreCallSignatures } from '../types';
import { StoreApi } from './types';

export function attachStoreHook<Store extends StoreApi<State>, State>(
  store: Store,
  getSnapshot: () => State,
  getServerSnapshot: (() => State) | undefined,
  defaultEqualityFn?: EqualityFn
): UseStoreCallSignatures<State> & Store {
  const subscribe = store.subscribe;

  function useStore(): State;
  function useStore<Selected>(selector: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function useStore<Selected>(selector?: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): State | Selected {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getServerSnapshot, selector, equalityFn ?? defaultEqualityFn);
  }

  return Object.assign(useStore, store);
}
