/**
 * **Worklet compatible**
 *
 * Performs a deep equality check between two values.
 *
 * This function recursively compares two values, checking if they are equal. For objects,
 * it validates that both have the same keys and that each corresponding value is deeply equal.
 * For non-objects, it uses strict equality.
 *
 * @param obj1 - The first value to compare.
 * @param obj2 - The second value to compare.
 * @returns `true` if the values are deeply equal; otherwise, `false`.
 */
export function deepEqual<U>(obj1: U, obj2: U): boolean {
  'worklet';
  // Validate object types upfront to avoid property access errors
  if (typeof obj1 !== 'object' || obj1 === null || obj1 === undefined || typeof obj2 !== 'object' || obj2 === null || obj2 === undefined) {
    // Simple and fast comparison for non-objects
    return obj1 === obj2;
  }
  // Early return if the references are the same
  if (Object.is(obj1, obj2)) {
    return true;
  }
  // Check if they have the same number of keys
  const keys1 = Object.keys(obj1);
  if (keys1.length !== Object.keys(obj2).length) {
    return false;
  }
  // Perform a deep comparison of keys and their values
  for (const key of keys1) {
    if (!(key in obj2) || !deepEqual(obj1[key as keyof U], obj2[key as keyof U])) {
      return false;
    }
  }
  return true;
}

/**
 * **Worklet compatible**
 *
 * Performs a shallow equality check between two values.
 *
 * For non-objects, uses strict equality (===). For objects, checks that both have identical
 * keys and compares their values using `Object.is` without recursing into nested objects.
 *
 * Ideal for preventing re-renders due to top-level object recreation.
 *
 * @param obj1 - The first value to compare.
 * @param obj2 - The second value to compare.
 * @returns `true` if the values are shallowly equal; otherwise, `false`.
 */
export function shallowEqual<U>(obj1: U, obj2: U): boolean {
  'worklet';
  // Validate object types upfront to avoid property access errors
  if (typeof obj1 !== 'object' || obj1 === null || obj1 === undefined || typeof obj2 !== 'object' || obj2 === null || obj2 === undefined) {
    // Simple and fast comparison for non-objects
    return obj1 === obj2;
  }
  // Early return if the references are the same
  if (Object.is(obj1, obj2)) {
    return true;
  }
  // Check if they have the same number of keys
  const keys1 = Object.keys(obj1);
  if (keys1.length !== Object.keys(obj2).length) {
    return false;
  }
  // Perform a shallow comparison of keys and their values
  for (const key of keys1) {
    if (!Object.is(obj1[key as keyof U], obj2[key as keyof U])) {
      return false;
    }
  }
  return true;
}

/**
 * Performs a deep equality check between two values, supporting objects, arrays, maps, sets, dates, regexps, array buffers, and more.
 * Copied from dequal@2.0.3 and fully typed for TypeScript.
 * @param foo - The first value to compare.
 * @param bar - The second value to compare.
 * @returns `true` if the values are deeply equal; otherwise, `false`.
 */
export function dequal(foo: unknown, bar: unknown): boolean {
  const has = Object.prototype.hasOwnProperty;

  function find(iter: Iterable<unknown>, tar: unknown): unknown {
    for (const key of (iter as any).keys()) {
      if (dequal(key, tar)) return key;
    }
  }

  let ctor: any, len: number, tmp: unknown;
  if (foo === bar) return true;

  if (foo && bar && (ctor = (foo as any).constructor) === (bar as any).constructor) {
    if (ctor === Date) return (foo as Date).getTime() === (bar as Date).getTime();
    if (ctor === RegExp) return (foo as RegExp).toString() === (bar as RegExp).toString();

    if (ctor === Array) {
      if ((len = (foo as unknown[]).length) === (bar as unknown[]).length) {
        while (len-- && dequal((foo as unknown[])[len], (bar as unknown[])[len]));
      }
      return len === -1;
    }

    if (ctor === Set) {
      if ((foo as Set<unknown>).size !== (bar as Set<unknown>).size) {
        return false;
      }
      for (let v of foo as Set<unknown>) {
        tmp = v;
        if (tmp && typeof tmp === 'object') {
          tmp = find(bar as Set<unknown>, tmp);
          if (!tmp) return false;
        }
        if (!(bar as Set<unknown>).has(tmp)) return false;
      }
      return true;
    }

    if (ctor === Map) {
      if ((foo as Map<unknown, unknown>).size !== (bar as Map<unknown, unknown>).size) {
        return false;
      }
      for (let entry of foo as Map<unknown, unknown>) {
        tmp = entry[0];
        if (tmp && typeof tmp === 'object') {
          tmp = find(bar as Map<unknown, unknown>, tmp);
          if (!tmp) return false;
        }
        if (!dequal(entry[1], (bar as Map<unknown, unknown>).get(tmp))) {
          return false;
        }
      }
      return true;
    }

    if (ctor === ArrayBuffer) {
      foo = new Uint8Array(foo as ArrayBuffer);
      bar = new Uint8Array(bar as ArrayBuffer);
    } else if (ctor === DataView) {
      if ((len = (foo as DataView).byteLength) === (bar as DataView).byteLength) {
        while (len-- && (foo as DataView).getInt8(len) === (bar as DataView).getInt8(len));
      }
      return len === -1;
    }

    if (ArrayBuffer.isView(foo) && ArrayBuffer.isView(bar)) {
      const fooView = foo as ArrayBufferView;
      const barView = bar as ArrayBufferView;
      if ((len = fooView.byteLength) === barView.byteLength) {
        while (len-- && (fooView as any)[len] === (barView as any)[len]);
      }
      return len === -1;
    }

    if (!ctor || typeof foo === 'object') {
      len = 0;
      for (const key in foo as Record<string, unknown>) {
        if (has.call(foo, key) && ++len && !has.call(bar, key)) return false;
        if (
          !(key in (bar as Record<string, unknown>)) ||
          !dequal((foo as Record<string, unknown>)[key], (bar as Record<string, unknown>)[key])
        )
          return false;
      }
      return Object.keys(bar as Record<string, unknown>).length === len;
    }
  }

  // handle NaN
  return foo !== foo && bar !== bar;
}
