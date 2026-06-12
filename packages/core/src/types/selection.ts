export type Selector<S, Selected> = (state: S) => Selected;
export type EqualityFn<T = unknown> = (a: T, b: T) => boolean;
