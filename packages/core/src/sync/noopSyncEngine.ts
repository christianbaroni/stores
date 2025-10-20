import type { SyncEngine, SyncHandle, SyncRegistration } from './types';

// ============ Noop Sync Engine =============================================== //

class NoopSyncHandle<T extends Record<string, unknown>> implements SyncHandle<T> {
  destroy(): void {
    return;
  }

  publish(): void {
    return;
  }
}

class NoopSyncEngine implements SyncEngine {
  register<T extends Record<string, unknown>>(_registration: SyncRegistration<T>): SyncHandle<T> {
    return new NoopSyncHandle<T>();
  }
}

const singleton = new NoopSyncEngine();

export function createNoopSyncEngine(): SyncEngine {
  return singleton;
}
