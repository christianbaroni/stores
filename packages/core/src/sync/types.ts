import { SyncDeltaDescriptor, SyncDeltaPayload } from '../plugins/delta/types';
import { UnknownFunction } from '../types/functions';

// ============ Field Metadata ================================================= //

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

// ============ Delta Types =================================================== //

/**
 * Per-field delta configuration. Use `true` to enable with defaults, or provide thresholds.
 */
export type SyncDeltaConfig<T extends Record<string, unknown>> = Partial<Record<SyncStateKey<T>, SyncDeltaDescriptor | true>>;

export type SyncDeltaMap<T extends Record<string, unknown>> = Partial<Record<SyncStateKey<T>, SyncDeltaPayload<T[SyncStateKey<T>]>>>;

// ============ Sync Update =================================================== //

export type SyncUpdate<T extends Record<string, unknown>> = {
  deltas?: SyncDeltaMap<T>;
  replace: boolean;
  sessionId: string;
  timestamp: number;
  values: SyncValues<T>;
};

// ============ Sync Registration ============================================= //

/**
 * Passed to `SyncEngine.register()` to connect a store to the sync system.
 */
export type SyncRegistration<T extends Record<string, unknown>> = {
  /** Callback invoked by the engine to apply incoming remote updates to the store. */
  apply: (update: SyncUpdate<T>) => void;
  /** Per-field delta configuration. Only used by delta-capable engines. */
  delta?: SyncDeltaConfig<T>;
  /** The state keys to sync. Non-function properties only. */
  fields: ReadonlyArray<SyncStateKey<T>>;
  /** Returns the store's current state. Used by engines that need to read state (e.g., for diffing). */
  getState: () => T;
  /** Unique identifier for this store. Must match across clients to sync the same data. */
  key: string;
};

/**
 * Returned by `SyncEngine.register()`. Controls the lifecycle of a synced store.
 */
export interface SyncHandle<T extends Record<string, unknown>> {
  /**
   * Permanently removes this store from the sync engine. After calling, the handle
   * is invalid and the store will no longer send or receive updates. To temporarily
   * pause sync, use `onFirstSubscribe`/`onLastUnsubscribe` lifecycle hooks instead.
   */
  destroy: () => void;

  /** Returns `true` once the store has received its initial state from the engine. */
  hydrated?: () => boolean;

  /**
   * Called when the store's subscriber count goes from 0 to 1. The registration
   * remains active. Use for lazy resource acquisition (e.g., opening a WebSocket).
   */
  onFirstSubscribe?: () => void;

  /** Registers a one-time callback to run when hydration completes. */
  onHydrated?: (callback: () => void) => void;

  /**
   * Called when the store's subscriber count drops to 0. The registration remains
   * active and `onFirstSubscribe` will fire again on the next subscription.
   * Use for resource cleanup (e.g., closing idle connections).
   */
  onLastUnsubscribe?: () => void;

  /**
   * Broadcasts a state update to other clients. Set to `null` for engines where
   * publishing is implicit (e.g., `chrome.storage` where the write itself triggers sync).
   */
  publish: ((update: SyncUpdate<T>) => void) | null;
}

// ============ Sync Engine =================================================== //

/**
 * Interface for multi-client state synchronization. Stores register to send and receive updates.
 */
export interface SyncEngine {
  /**
   * When `true`, embeds sync metadata (`{ origin, timestamp, fields }`) into persisted
   * storage values. Required for engines that use storage writes as their transport.
   * Only effective when the store is also persisted.
   * @default false
   */
  readonly injectStorageMetadata?: boolean;

  /** Registers a store for synchronization. Returns a handle to control the sync lifecycle. */
  register: {
    <T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T>;
    (registration: SyncRegistration<Record<string, unknown>>): SyncHandle<Record<string, unknown>>;
  };

  /** Unique identifier for this client session. Used for conflict resolution and filtering self-updates. */
  readonly sessionId: string;
}

export type SyncMergeFn<T, TState = unknown> = (incoming: T, current: T, currentState: TState, incomingValues: Partial<TState>) => T;

// ============ Sync Config =================================================== //

export type SyncConfig<T extends Record<string, unknown>> = {
  /**
   * The delta configuration for the sync engine.
   *
   * Only takes effect when used with delta-enabled engines like `NetworkSyncEngine`.
   * @default undefined
   */
  delta?: SyncDeltaConfig<T>;

  /**
   * The sync engine implementation to use.
   *
   * Defaults to cross-tab sync in browser environments. No-op in other environments unless a
   * custom engine is provided.
   */
  engine?: SyncEngine;

  /** The state keys to sync. If unspecified, all non-function store properties are synced. */
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

  /** The key used to identify the store to the sync engine. Required if `storageKey` is absent. */
  key?: string;

  /** Optional merge function to use for each synced state key. Use with caution. */
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
