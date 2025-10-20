import { getStoresConfig } from '../config';
import { StoresError } from '../logger';
import type { StateCreator } from '../types';
import { createSyncedStateCreator } from './syncEnhancer';
import type { NormalizedSyncConfig, SyncConfig } from './types';

// ============ Sync Helper ==================================================== //

function isNormalizedConfig<T extends Record<string, unknown>>(config: SyncConfig<T>): config is NormalizedSyncConfig<T> {
  return typeof config.key === 'string';
}

export function withSync<T extends Record<string, unknown>>(stateCreator: StateCreator<T>, config: SyncConfig<T>): StateCreator<T> {
  if (!isNormalizedConfig(config)) {
    throw new StoresError('[withSync]: config.key is required');
  }
  const { syncEngine } = getStoresConfig();
  return createSyncedStateCreator(stateCreator, config, syncEngine);
}
