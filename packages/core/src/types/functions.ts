/** Extract the keys of T whose values are functions. */
export type FunctionKeys<T> = {
  [K in keyof T]-?: T[K] extends UnknownFunction ? K : never;
}[keyof T];

export type OmitFunctionKeys<T> = Omit<T, FunctionKeys<T>>;

export type UnknownFunction = (...args: never[]) => unknown;
