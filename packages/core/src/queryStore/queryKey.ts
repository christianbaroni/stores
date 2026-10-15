import { isPlainObject } from '../types/utils';
import { nullObject } from '../utils/core';

// ============ Query Keys ===================================================== //

/**
 * Generates a deterministic query store `queryKey` from the given
 * key payload, consistent with internally generated keys.
 */
export function getQueryKey<TKeyPayload extends Record<string, unknown>>(keyPayload: TKeyPayload): string {
  if (typeof keyPayload !== 'object' || keyPayload === null) return JSON.stringify(keyPayload);

  const keys = Object.keys(keyPayload);
  return keys.length ? JSON.stringify(sortParamKeys(keyPayload, keys)) : '{}';
}

/**
 * Parses a query store `queryKey` into the key payload it encodes.
 */
export function parseQueryKey<TKeyPayload extends Record<string, unknown> = Record<string, unknown>>(queryKey: string): TKeyPayload {
  return JSON.parse(queryKey);
}

function sortParamKeys<TKeyPayload extends Record<string, unknown>>(
  keyPayload: TKeyPayload,
  keys = Object.keys(keyPayload)
): Record<string, unknown> {
  return keys.sort().reduce<Record<string, unknown>>((sorted, key) => {
    const value = keyPayload[key];
    sorted[key] = isPlainObject(value) ? sortParamKeys(value) : value;
    return sorted;
  }, nullObject());
}
