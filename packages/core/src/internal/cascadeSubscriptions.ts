import type { Listener } from '../types';
import type { StoreApi } from '../store/types';

/**
 * Internal unsubscribe callback used by store-to-store subscriptions that may suppress fetch aborts.
 */
export type InternalUnsubscribeFn = (skipAbortFetch?: boolean) => void;

/**
 * Internal full-state cascade subscription hook shared by store implementations.
 */
export const SUBSCRIBE_CASCADE_STATE = Symbol('stores.subscribeCascadeState');

/**
 * Store implementation that can subscribe full-state cascade listeners without selector work.
 */
export type CascadeStateSubscribable<State> = {
  [SUBSCRIBE_CASCADE_STATE]: CascadeStateSubscribe<State>;
};

type CascadeStateSubscribe<State> = (listener: Listener<State>) => InternalUnsubscribeFn;

/**
 * Returns whether a store exposes the internal full-state cascade subscription hook.
 */
export function hasCascadeStateSubscription<State>(store: StoreApi<State>): store is StoreApi<State> & CascadeStateSubscribable<State> {
  return SUBSCRIBE_CASCADE_STATE in store;
}

/**
 * Applies subscription lifecycle wrappers to the internal full-state cascade lane when present.
 */
export function wrapCascadeStateSubscription<State>(
  store: StoreApi<State>,
  wrap: (subscribe: CascadeStateSubscribe<State>) => CascadeStateSubscribe<State>
): void {
  if (hasCascadeStateSubscription(store)) store[SUBSCRIBE_CASCADE_STATE] = wrap(store[SUBSCRIBE_CASCADE_STATE]);
}
