import { isPlainObject } from '../types/utils';
import { nullObject } from '../utils/core';

// ============ Query Keys ===================================================== //

/**
 * Generates a deterministic query store `queryKey` from the given
 * key payload, consistent with internally generated keys.
 */
export function getQueryKey<TKeyPayload extends Record<string, unknown>>(keyPayload: TKeyPayload): string {
  return JSON.stringify(sortParamKeys(keyPayload));
}

/**
 * Parses a query store `queryKey` into the key payload it encodes.
 */
export function parseQueryKey<TKeyPayload extends Record<string, unknown> = Record<string, unknown>>(queryKey: string): TKeyPayload {
  return JSON.parse(queryKey);
}

function sortParamKeys<TKeyPayload extends Record<string, unknown>>(keyPayload: TKeyPayload): Record<string, unknown> {
  if (typeof keyPayload !== 'object' || keyPayload === null) return keyPayload;

  return Object.keys(keyPayload)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const value = keyPayload[key];
      acc[key] = isPlainObject(value) ? sortParamKeys(value) : value;
      return acc;
    }, nullObject());
}
