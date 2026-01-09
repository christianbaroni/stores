import { SyncEngine, SyncHandle, SyncRegistration } from './types';

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
  readonly sessionId = 'noop';

  register<T extends Record<string, unknown>>(_registration: SyncRegistration<T>): SyncHandle<T> {
    return new NoopSyncHandle<T>();
  }
}

let sharedNoopEngine: NoopSyncEngine | undefined;

export function createNoopSyncEngine(): SyncEngine {
  if (!sharedNoopEngine) sharedNoopEngine = new NoopSyncEngine();
  return sharedNoopEngine;
}
