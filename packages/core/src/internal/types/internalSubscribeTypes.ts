import type { Listener, ListenerArgs, Selector, SubscribeOptions } from '../../types/subscribe';

export type InternalSubscribeOptions<Selected> = SubscribeOptions<Selected> & {
  isCascadeParticipant?: boolean;
};

export type InternalSelectorArgs<S, Selected> = [
  selector: Selector<S, Selected>,
  listener: Listener<Selected>,
  options?: InternalSubscribeOptions<Selected>,
];

export type InternalSubscribeArgs<S, Selected = unknown> = ListenerArgs<S> | InternalSelectorArgs<S, Selected>;
export type InternalUnsubscribeFn = (skipAbortFetch?: boolean) => void;

export type InternalSubscribeOverloads<S> = {
  (...args: ListenerArgs<S>): InternalUnsubscribeFn;
  <Selected>(...args: InternalSelectorArgs<S, Selected>): InternalUnsubscribeFn;
};
