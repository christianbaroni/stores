/**
 * Forces TypeScript to expand a type for clearer IDE display.
 */
export type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

/**
 * Enforce no overlapping keys between two objects.
 */
export type NoOverlap<A, B> = B & Record<Extract<keyof A, keyof B>, never>;
