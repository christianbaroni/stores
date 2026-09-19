/**
 * Primitive types, excluding undefined.
 */
export type Primitive = string | number | boolean | bigint | symbol | null;

/**
 * Widen literal types to their base types (e.g., `0` → `number`, `'foo'` → `string`).
 */
export type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean : T extends bigint ? bigint : T;
