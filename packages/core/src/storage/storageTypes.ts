export type StorageValue<S, HideSyncMetadata extends boolean = false> = HideSyncMetadata extends true
  ? {
      state: S;
      version?: number;
    }
  : {
      state: S;
      syncMetadata?: { origin?: string; timestamp?: number; fields?: Record<string, number> };
      version?: number;
    };
