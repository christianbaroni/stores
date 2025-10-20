// ============ Sync Engine Types ============================================== //

type UnknownFunction = (...args: unknown[]) => unknown;

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
  destroy(): void;
  hydrated?(): boolean;
  onHydrated?(callback: () => void): void;
  publish(update: SyncUpdate<T>): void;
}

export interface SyncEngine {
  register<T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T>;
}

export type SyncMergeFn<T, TState = unknown> = (incoming: T, current: T, currentState: TState, incomingValues: Partial<TState>) => T;

export type SyncConfig<T extends Record<string, unknown>> = {
  engine?: SyncEngine;
  fields?: ReadonlyArray<SyncStateKey<T>>;
  key?: string;
  merge?: {
    [K in SyncStateKey<T>]?: SyncMergeFn<T[K], T>;
  };
};

/**
 * Internal type for SyncConfig after normalization - key is always present.
 */
export type NormalizedSyncConfig<T extends Record<string, unknown>> = SyncConfig<T> & {
  key: string;
};
