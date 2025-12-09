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
