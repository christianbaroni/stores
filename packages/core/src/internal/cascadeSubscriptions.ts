import type { StoreApi } from '../store/types';
import type { Listener } from '../types';
import { identity } from '../utils/core';
import type { InternalUnsubscribeFn } from './internalSubscriptions';

// ============ Types ========================================================== //

/**
 * Store implementation that can subscribe full-state cascade listeners without selector work.
 */
export type CascadeStateSubscribable<State> = {
  [SUBSCRIBE_CASCADE_STATE]: CascadeStateSubscribe<State>;
};

type CascadeStateSubscribe<State> = (listener: Listener<State>) => InternalUnsubscribeFn;

// ============ Constants ====================================================== //

/**
 * Internal full-state cascade subscription hook shared by store implementations.
 */
export const SUBSCRIBE_CASCADE_STATE: unique symbol = Symbol('stores.subscribeCascadeState');

/**
 *  Shared options for dependency subscriptions that participate in cascade propagation.
 */
export const CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS: Readonly<{ equalityFn: typeof Object.is; isCascadeParticipant: true }> = Object.freeze({
  equalityFn: Object.is,
  isCascadeParticipant: true,
});

// ============ Utilities ====================================================== //

/**
 * Returns whether the store exposes the internal cascade subscription hook.
 */
export function hasNativeSubscriptions<State>(store: StoreApi<State>): store is StoreApi<State> & CascadeStateSubscribable<State> {
  return SUBSCRIBE_CASCADE_STATE in store;
}

/**
 * Applies subscription lifecycle wrappers to the internal full-state cascade lane when present.
 */
export function wrapCascadeStateSubscription<State>(
  store: StoreApi<State>,
  wrap: (subscribe: CascadeStateSubscribe<State>) => CascadeStateSubscribe<State>
): void {
  if (hasNativeSubscriptions(store)) store[SUBSCRIBE_CASCADE_STATE] = wrap(store[SUBSCRIBE_CASCADE_STATE]);
}

/**
 * Subscribes to full-state cascade updates.
 */
export function subscribeCascadeState<State>(store: StoreApi<State>, listener: Listener<State>): InternalUnsubscribeFn {
  return hasNativeSubscriptions(store)
    ? store[SUBSCRIBE_CASCADE_STATE](listener)
    : store.subscribe<State>(identity, listener, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS);
}
