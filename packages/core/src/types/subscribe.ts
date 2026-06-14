// ============ Common Utility Types =========================================== //

export type Listener<S> = (state: S, prevState: S) => void;
export type Selector<S, Selected> = (state: S) => Selected;
export type EqualityFn<T = unknown> = (a: T, b: T) => boolean;

// ============ Subscribe Types ================================================ //

/**
 * Minimum store API required for subscription.
 */
export type SubscribableStore = {
  subscribe(selector: Selector<unknown, unknown>, listener: () => void, options?: SubscribeOptions<unknown>): UnsubscribeFn;
};

export type SubscribeOptions<Selected> = {
  equalityFn?: EqualityFn<Selected>;
  fireImmediately?: boolean;
  isDerivedStore?: boolean;
};

export type ListenerArgs<S> = [listener: Listener<S>];
export type SelectorArgs<S, Selected> = [
  selector: Selector<S, Selected>,
  listener: Listener<Selected>,
  options?: SubscribeOptions<Selected>,
];

export type SubscribeArgs<S, Selected = unknown> = ListenerArgs<S> | SelectorArgs<S, Selected>;
export type UnsubscribeFn<Options extends boolean = false> = Options extends true ? (skipAbortFetch?: boolean) => void : () => void;
export type SubscribeFn<S, Selected = S> = (...args: SubscribeArgs<S, Selected>) => UnsubscribeFn;

export type SubscribeOverloads<S, ExtraOptions extends boolean = false> = {
  (listener: Listener<S>): UnsubscribeFn<ExtraOptions>;
  <Selected>(
    selector: Selector<S, Selected>,
    listener: Listener<Selected>,
    options?: SubscribeOptions<Selected>
  ): UnsubscribeFn<ExtraOptions>;
};
