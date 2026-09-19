import type { Listener, ListenerArgs, Selector, SubscribeOptions } from '../../types/subscribe';
import type { InternalUnsubscribeFn } from '../../store/internalSubscriptions';

export type InternalSubscribeOptions<Selected> = SubscribeOptions<Selected> & {
  isCascadeParticipant?: boolean;
};

export type InternalSelectorArgs<S, Selected> = [
  selector: Selector<S, Selected>,
  listener: Listener<Selected>,
  options?: InternalSubscribeOptions<Selected>,
];

export type InternalSubscribeArgs<S, Selected = unknown> = InternalSelectorArgs<S, Selected> | ListenerArgs<S>;
export type { InternalUnsubscribeFn };

export type InternalSubscribeOverloads<S> = {
  (...args: ListenerArgs<S>): InternalUnsubscribeFn;
  <Selected>(...args: InternalSelectorArgs<S, Selected>): InternalUnsubscribeFn;
};
