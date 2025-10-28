// ============ Sync Engine Types ============================================== //

type UnknownFunction = (...args: unknown[]) => unknown;

// ============ Field Metadata ================================================= //

/**
 * Readable indices for `FieldMetadata` tuples.
 */
export const [TIMESTAMP, SESSION_ID]: [0, 1] = [0, 1];

/**
 * Metadata for a field's last write.
 */
export type FieldMetadata = readonly [timestamp: number, sessionId: string];

export type SyncStateKey<T extends Record<string, unknown>> = Extract<
  {
    [K in keyof T]-?: T[K] extends UnknownFunction ? never : K;
  }[keyof T],
  string
>;

export type SyncValues<T extends Record<string, unknown>> = Partial<T> & {
  [K in SyncStateKey<T>]?: T[K];
};

export type SyncUpdate<T extends Record<string, unknown>> = {
  replace: boolean;
  sessionId: string;
  timestamp: number;
  values: SyncValues<T>;
};

export type SyncRegistration<T extends Record<string, unknown>> = {
  apply: (update: SyncUpdate<T>) => void;
  fields: ReadonlyArray<SyncStateKey<T>>;
  getState: () => T;
  key: string;
};

export interface SyncHandle<T extends Record<string, unknown>> {
  destroy: () => void;
  hydrated?: () => boolean;
  onHydrated?: (callback: () => void) => void;
  publish: ((update: SyncUpdate<T>) => void) | null;
}

export interface SyncEngine {
  register<T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T>;
  /**
   * When true, injects sync metadata (`{ origin, timestamp, fields }`) into the persisted
   * storage payload. Only takes effect when used with a persisted store.
   *
   * Useful for sync engines that use storage events as their transport (e.g., `chrome.storage`).
   * @default false
   */
  readonly injectStorageMetadata?: boolean;
  readonly sessionId: string;
}

export type SyncMergeFn<T, TState = unknown> = (incoming: T, current: T, currentState: TState, incomingValues: Partial<TState>) => T;

export type SyncConfig<T extends Record<string, unknown>> = {
  engine?: SyncEngine;
  fields?: ReadonlyArray<SyncStateKey<T>>;
  /**
   * When true, injects sync metadata (`{ origin, timestamp, fields }`) into the persisted
   * storage payload. Only takes effect when used with a persisted store.
   *
   * Useful for sync engines that use storage events as their transport (e.g., `chrome.storage`).
   *
   * Can also be set on the `engine` object. This option takes precedence if both are provided.
   * @default false
   */
  injectStorageMetadata?: boolean;
  key?: string;
  merge?: {
    [K in SyncStateKey<T>]?: SyncMergeFn<T[K], T>;
  };
};

/**
 * Internal type for `SyncConfig` with `key` always present.
 */
export type NormalizedSyncConfig<T extends Record<string, unknown>> = SyncConfig<T> & {
  key: string;
};
