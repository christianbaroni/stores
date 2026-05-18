import { UnknownFunction } from './functions';

/** Forces TypeScript to expand a type for cleaner IDE display. */
export type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

export type NoOverlap<A, B> = B & Record<Extract<keyof A, keyof B>, never>;

export type ObjectMethods = Record<string, UnknownFunction>;
