export type StorageValue<S, WithSyncMetadata extends boolean = false> = WithSyncMetadata extends true
  ? {
      state: S;
      version?: number;
    }
  : {
      state: S;
      syncMetadata?: { origin?: string; timestamp?: number; fields?: Record<string, number> };
      version?: number;
    };
