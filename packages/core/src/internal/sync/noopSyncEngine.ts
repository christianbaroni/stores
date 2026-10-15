import { SyncEngine } from '../../sync/types';
import { noop } from '../../utils/core';

// ============ Noop Sync Engine =============================================== //

let sharedEngine: SyncEngine | undefined;

/**
 * Returns the inert default sync engine used outside browsers.
 */
export function createNoopSyncEngine(): SyncEngine {
  if (!sharedEngine) {
    const noopHandle = { destroy: noop, publish: noop };

    sharedEngine = {
      sessionId: 'noop',
      register: () => noopHandle,
    };
  }

  return sharedEngine;
}
