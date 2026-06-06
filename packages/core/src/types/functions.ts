/**
 * Relaxes function parameter variance to allow subtype
 * assignment otherwise blocked by strict contravariance.
 */
export type BivariantMethod<T extends Record<string, UnknownFunction>> = T[keyof T];

/**
 * Extract the keys of `T` whose values are functions.
 */
export type FunctionKeys<T> = {
  [K in keyof T]-?: T[K] extends UnknownFunction ? K : never;
}[keyof T];

/**
 * A record of string keys to unknown functions.
 */
export type FunctionRecord = Record<string, UnknownFunction>;

/**
 * Return `T` if it is **not** a function, otherwise `never`.
 */
export type NonFunction<T> = T extends (...args: infer _) => unknown ? never : T;

/**
 * Unknown generic function type.
 */
export type UnknownFunction = (...args: never[]) => unknown;
