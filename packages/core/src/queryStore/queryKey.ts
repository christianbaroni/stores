import { isPlainObject } from '../types/utils';
import { nullObject } from '../utils/core';

// ============ Query Keys ===================================================== //

export function getQueryKey<TParams extends Record<string, unknown>>(params: TParams): string {
  return JSON.stringify(sortParamKeys(params));
}

export function parseQueryKey<TParams extends Record<string, unknown>>(queryKey: string): TParams {
  return JSON.parse(queryKey);
}

function sortParamKeys<TParams extends Record<string, unknown>>(params: TParams): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) return params;

  return Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const value = params[key];
      acc[key] = isPlainObject(value) ? sortParamKeys(value) : value;
      return acc;
    }, nullObject());
}
