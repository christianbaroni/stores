const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Typed `hasOwnProperty` alias.
 */
export function hasOwn<T extends Record<string, unknown>, K extends string>(value: T, key: K): value is T & Record<K, unknown> {
  return hasOwnProperty.call(value, key);
}

/**
 * Checks prototype is `Object.prototype` or `null`. Excludes arrays, class instances, etc.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
