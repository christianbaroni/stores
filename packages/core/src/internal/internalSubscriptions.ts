import type { EqualityFn, Listener, ListenerArgs, Selector, SubscribeOptions } from '../types/subscribe';

// ============ Constants ====================================================== //

/**
 * Flags for selection attachment and cascade participation.
 */
export const enum SelectionFlags {
  None = 0,
  Attaching = 1,
  Cascade = 2,
}

/**
 * Marks a selection that has not accepted its first value.
 */
export const UNINITIALIZED_SELECTION: unique symbol = Symbol();

// ============ Types ========================================================== //

/**
 * Internal unsubscribe callback used by store-to-store subscriptions that may suppress fetch aborts.
 */
export type InternalUnsubscribeFn = (skipAbortFetch?: boolean) => void;

/**
 * Extended, internal-only subscription options.
 */
export type InternalSubscribeOptions<Selected> = SubscribeOptions<Selected> & {
  isCascadeParticipant?: boolean;
  selection?: Selection<Selected>;
};

export type InternalSelectorArgs<S, Selected> = [
  selector: Selector<S, Selected>,
  listener: Listener<Selected>,
  options?: InternalSubscribeOptions<Selected>,
];

export type InternalSubscribeArgs<S, Selected = unknown> = InternalSelectorArgs<S, Selected> | ListenerArgs<S>;

export type InternalSubscribeOverloads<S> = {
  (...args: ListenerArgs<S>): InternalUnsubscribeFn;
  <Selected>(...args: InternalSelectorArgs<S, Selected>): InternalUnsubscribeFn;
};

/**
 * Selection state shared by store updates and manual refreshes.
 * Equal results retain the previously accepted value.
 */
export type Selection<Selected> = {
  currentSlice: Selected | typeof UNINITIALIZED_SELECTION;
  readonly equalityFn: EqualityFn<Selected>;
  readonly listener: Listener<Selected>;
  flags: SelectionFlags;
  refresh: () => void;
};
