/** Extract the keys of T whose values are functions. */
export type FunctionKeys<T> = {
  [K in keyof T]-?: T[K] extends UnknownFunction ? K : never;
}[keyof T];

/** Returns `T` if it is **not** a function, otherwise `never`. */
export type NonFunction<T> = T extends (...args: infer _) => unknown ? never : T;

/** Omit the function keys from T. */
export type OmitFunctionKeys<T> = Omit<T, FunctionKeys<T>>;

export type UnknownFunction = (...args: never[]) => unknown;
