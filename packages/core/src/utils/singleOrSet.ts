// ============ Types ========================================================== //

/**
 * Zero-wrapper representation of an identity collection:
 *
 * - count === 0: values === undefined
 * - count === 1: values is the sole T
 * - count >= 2: values is a Set<T> whose size equals count
 *
 * The caller-owned count is the discriminator, so operations perform no
 * runtime type test. T is restricted to non-null objects so null can encode
 * an idempotent mutation that made no change.
 */
export type SingleOrSet<T extends object> = T | Set<T> | undefined;

// ============ Public API ===================================================== //

/**
 * Adds value and returns the canonical next representation.
 * Returns null when value was already present.
 */
export function addToSingleOrSet<T extends object>(values: SingleOrSet<T>, count: number, value: T): NonNullable<SingleOrSet<T>> | null {
  if (count === 0) return value;

  if (count === 1) {
    if (values === value) return null;
    assertSingleValue(values);
    const set = new Set<T>();
    set.add(values);
    set.add(value);
    return set;
  }

  assertValueSet(values);
  values.add(value);
  return values.size === count ? null : values;
}

/**
 * Deletes value and returns the canonical next representation.
 * Returns null when value was not present.
 */
export function deleteFromSingleOrSet<T extends object>(values: SingleOrSet<T>, count: number, value: T): SingleOrSet<T> | null {
  if (count === 0) return null;
  if (count === 1) return values === value ? undefined : null;

  assertValueSet(values);
  if (!values.delete(value)) return null;
  if (count !== 2) return values;

  for (const remaining of values) return remaining;
  return undefined;
}

/**
 * Visits values in insertion order without allocating a capturing callback at
 * the call site. The two context arguments map directly to notification paths
 * that deliver current and previous state.
 */
export function forEachSingleOrSet<T extends object, Arg1, Arg2>(
  values: SingleOrSet<T>,
  count: number,
  callback: (value: T, arg1: Arg1, arg2: Arg2) => void,
  arg1: Arg1,
  arg2: Arg2
): void {
  if (count === 0) return;

  if (count === 1) {
    assertSingleValue(values);
    callback(values, arg1, arg2);
    return;
  }

  assertValueSet(values);
  for (const value of values) callback(value, arg1, arg2);
}

/**
 * Clears an active Set before releasing it. This preserves the existing
 * reentrant-destroy behavior: clearing during notification stops the active
 * Set iterator.
 */
export function clearSingleOrSet<T extends object>(values: SingleOrSet<T>, count: number): undefined {
  if (count > 1) {
    assertValueSet(values);
    values.clear();
  }
  return undefined;
}

// ============ Helpers ======================================================== //

function assertSingleValue<T extends object>(values: SingleOrSet<T>): asserts values is T {
  return;
}

function assertValueSet<T extends object>(values: SingleOrSet<T>): asserts values is Set<T> {
  return;
}
