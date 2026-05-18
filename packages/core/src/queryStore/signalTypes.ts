import { BaseStore } from '../types';

type NestedAttachValue<T> = T extends object ? { readonly [K in keyof T]: AttachValue<T[K]> } : Record<string, never>;

export type AttachValue<T> = {
  readonly value: T;
} & NestedAttachValue<T>;

export type SignalFunction = {
  <T>(store: BaseStore<T>): AttachValue<T>;
  <T, S>(store: BaseStore<T>, selector: (state: T) => S, equalityFn?: (a: S, b: S) => boolean): AttachValue<S>;
};
