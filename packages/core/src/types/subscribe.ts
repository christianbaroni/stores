// ============ Selected State ================================================= //

export type Selector<S, Selected> = (state: S) => Selected;
export type EqualityFn<T = unknown> = (a: T, b: T) => boolean;

// ============ Subscribe ====================================================== //

export type SubscribeOverloads<S, ExtraOptions extends boolean = false> = {
  (listener: Listener<S>): UnsubscribeFn<ExtraOptions>;
  <Selected>(
    selector: Selector<S, Selected>,
    listener: Listener<Selected>,
    options?: SubscribeOptions<Selected>
  ): UnsubscribeFn<ExtraOptions>;
};

export type SubscribeFn<S, Selected = S> = (...args: SubscribeArgs<S, Selected>) => UnsubscribeFn;

/**
 * Store contract required to subscribe to selected state.
 */
export type SubscribableStore = {
  subscribe: SubscribeOverloads<unknown>;
};

export type SubscribeArgs<S, Selected = unknown> = ListenerArgs<S> | SelectorArgs<S, Selected>;
export type ListenerArgs<S> = [listener: Listener<S>];
export type SelectorArgs<S, Selected> = [
  selector: Selector<S, Selected>,
  listener: Listener<Selected>,
  options?: SubscribeOptions<Selected>,
];

export type SubscribeOptions<Selected> = {
  equalityFn?: EqualityFn<Selected>;
  fireImmediately?: boolean;
  isDerivedStore?: boolean;
};

export type Listener<S> = (state: S, prevState: S) => void;
export type UnsubscribeFn<Options extends boolean = false> = Options extends true ? (skipAbortFetch?: boolean) => void : () => void;
