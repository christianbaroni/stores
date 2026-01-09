// ============ Sync Engine Types ============================================== //

type UnknownFunction = (...args: unknown[]) => unknown;

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

export type RecordDeltaPayload<TValue = unknown> = {
  readonly clear?: true;
  readonly del?: readonly string[];
  readonly set?: Record<string, TValue>;
  readonly patch?: Record<string, RecordDeltaPayload>;
};

export type SyncDeltaPayload<TValue = unknown> = { readonly kind: 'record' } & RecordDeltaPayload<TValue>;

export type SyncDeltaDescriptor = {
  /**
   * Minimum fraction of the full payload the delta must save (0–1).
   */
  readonly minSavingsRatio?: number;
  /**
   * Minimum number of bytes the delta must save compared to sending the full payload.
   */
  readonly minSavingsBytes?: number;
};

/**
 * Per-field delta configuration. Use `true` to enable with defaults, or provide thresholds.
 */
export type SyncDeltaConfig<T extends Record<string, unknown>> = Partial<Record<SyncStateKey<T>, SyncDeltaDescriptor | true>>;

export type SyncDeltaMap<T extends Record<string, unknown>> = Partial<Record<SyncStateKey<T>, SyncDeltaPayload<T[SyncStateKey<T>]>>>;

export type SyncUpdate<T extends Record<string, unknown>> = {
  deltas?: SyncDeltaMap<T>;
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
  delta?: SyncDeltaConfig<T>;
};

export interface SyncHandle<T extends Record<string, unknown>> {
  destroy: () => void;
  hydrated?: () => boolean;
  onHydrated?: (callback: () => void) => void;
  publish: ((update: SyncUpdate<T>) => void) | null;
}

export interface SyncEngine {
  register<T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T>;
  registerPresence?<Presence>(registration: SyncPresenceRegistration<Presence>): SyncPresenceChannel<Presence> | null;
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

export type SyncPresenceJoinHandler<Presence> = (userId: string, data: Presence) => void;

export type SyncPresenceUpdateHandler<Presence> = (userId: string, data: Presence) => void;

export type SyncPresenceLeaveHandler = (userId: string) => void;

export type PresencePruneStrategy = 'updates' | 'activity';

type PresenceActivityField<Presence> = Presence extends Record<string, unknown> ? Extract<keyof Presence, string> : string;

export type SyncPresenceHeartbeatConfig<Presence> =
  | {
      /** Interval in milliseconds between heartbeat broadcasts */
      interval: number;
      /** Reuse the last presence payload for each heartbeat (default). */
      behavior?: 'reuse' | undefined;
    }
  | {
      /** Interval in milliseconds between heartbeat broadcasts */
      interval: number;
      /** Clone the payload and refresh an activity field on every heartbeat. */
      behavior: 'refresh-activity';
      /**
       * Field from the presence payload to refresh. Defaults to the prune strategy's activity field or `timestamp`.
       */
      activityField?: PresenceActivityField<Presence>;
    }
  | {
      /** Interval in milliseconds between heartbeat broadcasts */
      interval: number;
      /** Derive a custom payload for each heartbeat. */
      behavior: 'transform';
      /**
       * Transform invoked before each heartbeat. Return a payload to broadcast, or void to reuse the current data.
       */
      onHeartbeat: (currentData: Presence) => Presence | void;
    };

export type SyncPresenceRegistration<Presence> = {
  key: string;
  /**
   * Optional heartbeat configuration. When enabled, presence data is re-broadcast at the
   * specified interval. Use `'reuse'` (default) to emit the last payload unchanged, `'refresh-activity'`
   * to automatically update a timestamp-like field on object payloads, or `'transform'` to derive a custom payload.
   */
  heartbeat?: SyncPresenceHeartbeatConfig<Presence>;
  /**
   * Optional stale presence pruning. When enabled, remote presence entries that
   * haven't been updated within the specified threshold are automatically removed.
   */
  pruneStale?: {
    /**
     * Determines how staleness is evaluated.
     * - `updates` (default) considers the time since the last presence message arrived.
     * - `activity` considers a timestamp field within the presence payload (defaults to `timestamp`).
     */
    basedOn?: PresencePruneStrategy;
    /**
     * Field from the presence payload to inspect when `basedOn` is set to `activity`.
     * Defaults to `timestamp`.
     */
    activityField?: PresenceActivityField<Presence>;
    /** Time in milliseconds after which presence is considered stale */
    after: number;
    /** Optional callback invoked before removing stale presence */
    onPrune?: (userId: string, data: Presence) => void;
  };
  onJoin?: SyncPresenceJoinHandler<Presence>;
  onLeave?: SyncPresenceLeaveHandler;
  onUpdate?: SyncPresenceUpdateHandler<Presence>;
};

export interface SyncPresenceChannel<Presence> {
  join(userId: string, data: Presence): void;
  leave(): void;
  update(data: Presence): void;
  /**
   * Destroys the presence channel and cleans up all resources.
   * Automatically calls leave() and clears all timers.
   * Safe to call multiple times.
   */
  destroy(): void;
}

export type SyncConfig<T extends Record<string, unknown>> = {
  engine?: SyncEngine;
  fields?: ReadonlyArray<SyncStateKey<T>>;
  /**
   * The delta configuration for the sync engine.
   *
   * Only takes effect when used with delta-enabled engines like `NetworkSyncEngine`.
   * @default undefined
   */
  delta?: SyncDeltaConfig<T>;
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

// ============ Authentication Types ========================================= //

export type SyncAuthPhase = 'connect' | 'refresh' | 'challenge';

export type SyncAuthPayload = {
  readonly headers?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly token?: string;
};

export type SyncAuthFailure = {
  readonly code: string;
  readonly message?: string;
  readonly retryable: boolean;
};

export type SyncAuthenticator = {
  readonly getPayload: (phase: SyncAuthPhase) => Promise<SyncAuthPayload | null> | SyncAuthPayload | null;
  readonly onFailure?: (failure: SyncAuthFailure) => void;
};
