import { StoresError, logger } from '../logger';
import { StorageValue } from '../storage/storageTypes';
import { replacer, reviver } from './serialization';

/**
 * Default partialize function if none is provided. It omits top-level store
 * methods and keeps all other state.
 */
export function omitStoreMethods<S, PersistedState extends Partial<S>>(state: S): PersistedState {
  if (state !== null && typeof state === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(state)) {
      if (typeof val !== 'function') {
        result[key] = val;
      }
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return result as PersistedState;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return state as unknown as PersistedState;
}

export function defaultSerializeState<PersistedState>(storageValue: StorageValue<PersistedState>, shouldUseReplacer: boolean): string {
  try {
    return JSON.stringify(storageValue, shouldUseReplacer ? replacer : undefined);
  } catch (error) {
    logger.error(new StoresError(`[createBaseStore]: Failed to serialize Rainbow store data`), { error });
    throw error;
  }
}

export function defaultDeserializeState<PersistedState>(serializedState: string, shouldUseReviver: boolean): StorageValue<PersistedState> {
  try {
    return JSON.parse(serializedState, shouldUseReviver ? reviver : undefined);
  } catch (error) {
    logger.error(new StoresError(`[createBaseStore]: Failed to deserialize persisted Rainbow store data`), { error });
    throw error;
  }
}
