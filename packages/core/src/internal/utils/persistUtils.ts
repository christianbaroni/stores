import type { StorageValue } from '../../storage/storageTypes';
import { isPlainObject } from '../../types/utils';
import { nullObject } from '../../utils/core';
import { replacer, reviver } from '../../utils/serialization';
import { StoresError } from '../errors';
import { logger } from '../logger';

/**
 * Default partialize function if none is provided. It omits top-level store
 * methods and keeps all other state.
 */
export function omitStoreMethods<S, PersistedState extends Partial<S> = Partial<S>>(state: S): PersistedState;
export function omitStoreMethods(state: unknown): unknown {
  if (!isPlainObject(state)) return state;

  const result: Record<string, unknown> = nullObject();
  const keys = Object.keys(state);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = state[key];
    if (typeof value !== 'function') result[key] = value;
  }
  return result;
}

export function defaultSerializeState<PersistedState>(storageValue: StorageValue<PersistedState>, shouldUseReplacer: boolean): string {
  try {
    return JSON.stringify(storageValue, shouldUseReplacer ? replacer : undefined);
  } catch (error) {
    logger.error(new StoresError(`[createBaseStore]: Failed to serialize store data`, error));
    throw error;
  }
}

export function defaultDeserializeState<PersistedState>(serializedState: string, shouldUseReviver: boolean): StorageValue<PersistedState> {
  try {
    return JSON.parse(serializedState, shouldUseReviver ? reviver : undefined);
  } catch (error) {
    logger.error(new StoresError(`[createBaseStore]: Failed to deserialize persisted store data`, error));
    throw error;
  }
}
