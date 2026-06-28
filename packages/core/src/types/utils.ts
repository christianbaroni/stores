const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Typed `hasOwnProperty` alias.
 */
export function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): key is K & keyof T {
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

/**
 * Checks for non-null, non-array objects.
 */
export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
