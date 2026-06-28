import type { EqualityFn } from '../types';
import type { UseStoreCallSignatures } from '../types/useStoreCallSignatures.vanilla';
import { StoreApi } from './types';

export function attachStoreHook<Store extends StoreApi<State>, State>(
  store: Store,
  _getSnapshot: () => State,
  _getServerSnapshot: (() => State) | undefined,
  _defaultEqualityFn?: EqualityFn
): UseStoreCallSignatures<State> & Store {
  return store;
}
