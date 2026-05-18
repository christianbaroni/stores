/**
 * Returns the first argument provided to it.
 * @param value - Any value.
 * @returns `value`.
 */
export function identity<T>(value: T): T;
export function identity<S, T>(value: S): T;
export function identity<S, T>(value: T): S | T {
  return value;
}

/**
 * Constructs null-prototype objects using a shared frozen prototype.
 */
export const NullObj = /*#__PURE__*/ (() => {
  const Constructor = function () {};
  Constructor.prototype = Object.freeze(Object.create(null));
  assertConstructorType(Constructor);
  return Constructor;
})();

/**
 * Builds null-prototype objects using `NullObj`. Provided arguments
 * are shallow-merged into a newly created null-prototype object:
 *
 * ```ts
 * Object.assign(new NullObj(), a, b?)
 * ```
 */
export function buildNullObject<Target extends Record<string, unknown>>(a: Target): Target;
export function buildNullObject<A extends object, B>(a: object, b?: object): [undefined] extends B ? A : A & B;
export function buildNullObject<A extends object, B>(a: A, b?: B): A & B {
  return Object.assign(new NullObj(), a, b);
}

function assertConstructorType(
  value: unknown
): asserts value is { new <T extends Record<string, unknown> | object = Record<string, unknown>>(): T } {
  return;
}
