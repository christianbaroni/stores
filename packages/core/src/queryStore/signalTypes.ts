import type { StoreApi } from '../store/types';
import type { EqualityFn, Selector } from '../types/subscribe';

type NestedAttachValue<T> = T extends object ? { readonly [K in keyof T]: AttachValue<T[K]> } : Record<string, never>;

export type AttachValue<T> = {
  readonly value: T;
} & NestedAttachValue<T>;

export type SignalFunction = {
  <T>(store: StoreApi<T>): AttachValue<T>;
  <T, S>(store: StoreApi<T>, selector: Selector<T, S>, equalityFn?: EqualityFn<S>): AttachValue<S>;
};
