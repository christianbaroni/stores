import type { EqualityFn, SubscribeOverloads } from '../types';
import type { UseStoreCallSignatures } from '../types/useStoreCallSignatures.vanilla';

export function attachStoreHook<State, Store extends { subscribe: SubscribeOverloads<State> }>(
  store: Store,
  _getSnapshot: () => State,
  _getServerSnapshot?: () => State,
  _defaultEqualityFn?: EqualityFn
): UseStoreCallSignatures<State> & Store {
  return store;
}
