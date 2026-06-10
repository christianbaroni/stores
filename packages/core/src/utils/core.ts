import { IS_REACT_NATIVE } from '@/env';

// ============ Constants ====================================================== //

const SHARED_NULL_PROTOTYPE: object = Object.freeze(Object.create(null));

// ============ Core Utilities ================================================= //

/**
 * Returns the argument provided.
 */
export function identity<T>(value: T): T;
export function identity<T, _>(value: T): T;
export function identity<T, _>(value: T): T {
  return value;
}

/**
 * Creates a null-prototype object using the runtime-optimal path:
 *  - React Native: direct literal `{ __proto__: null }`
 *  - Web/Node: `Object.create` with a shared, frozen null prototype
 */
export function nullObject<T extends Record<string, unknown> | object = Record<string, unknown>>(): T {
  return (IS_REACT_NATIVE ? { __proto__: null } : Object.create(SHARED_NULL_PROTOTYPE)) satisfies T;
}

/**
 * Builds null-prototype objects. Provided arguments are
 * shallow-merged into a newly created null-prototype object:
 *
 * ```ts
 * Object.assign(nullObject(), a, b?)
 * ```
 */
export function buildNullObject<A extends Record<string, unknown>>(a: A): A;
export function buildNullObject<A extends object, B>(a: object, b?: object): [undefined] extends B ? A : A & B;
export function buildNullObject<A extends object, B>(a: A, b?: B): A & B {
  return b === undefined ? Object.assign(nullObject<A & B>(), a) : Object.assign(nullObject<A & B>(), a, b);
}

/**
 * Does nothing.
 */
export function noop(): void {
  return;
}
