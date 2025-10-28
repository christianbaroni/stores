import { StoresError, logger } from '../logger';
import { StorageValue } from '../storage/storageTypes';

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

type SerializedMap = {
  __type: 'Map';
  entries: [unknown, unknown][];
};

export function isSerializedMap(value: unknown): value is SerializedMap {
  return typeof value === 'object' && value !== null && '__type' in value && value.__type === 'Map';
}

type SerializedSet = {
  __type: 'Set';
  values: unknown[];
};

export function isSerializedSet(value: unknown): value is SerializedSet {
  return typeof value === 'object' && value !== null && '__type' in value && value.__type === 'Set';
}

export function replacer(_: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { __type: 'Map', entries: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { __type: 'Set', values: Array.from(value) };
  }
  return value;
}

export function reviver(_: string, value: unknown): unknown {
  if (isSerializedMap(value)) return new Map(value.entries);
  if (isSerializedSet(value)) return new Set(value.values);
  return value;
}
