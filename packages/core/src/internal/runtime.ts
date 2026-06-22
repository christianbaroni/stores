/* -- Config -------- */
export { configureStores } from './config';

/* -- Errors -------- */
export { StoresError } from './errors';

/* -- Query --------- */
export { QueryStatuses } from '../queryStore/types';
export { defaultRetryDelay } from './queryStore/queryStoreDefaults';

/* -- Helpers ------- */
export { applyStateUpdate } from '../store/stateUpdate';
export { replacer, reviver } from '../utils/serialization';
export {
  destroyStore,
  destroyStores,
  getStoreName,
  hasGetSnapshot,
  isDerivedStore,
  isPersistedStore,
  isQueryStore,
  isVirtualStore,
} from './storeUtils';

/* -- Utilities ----- */
export { identity, nullObject } from '../utils/core';
export { createStoreActions } from './createStoreActions';
export { deepEqual, shallowEqual } from '../utils/equality';
export { time } from '../utils/time';

/* -- Internal ------ */
export { baseStore } from './baseStore';
export { derivedStore } from './derivedStore';
export { queryStore } from './queryStore';
export { virtualStore } from './virtualStore';
export { DEFAULT_STORAGE_KEY_PREFIX, getOptions, getStorageConfig, markStoreCreated } from './config';
export { ensureError } from './errors';
export { logger, setLogger } from './logger';
export { StoreTags, assignStoreTag, hasDestroy } from './storeUtils';
