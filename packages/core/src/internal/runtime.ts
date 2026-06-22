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
/** @internal */
export { baseStore } from './baseStore';
/** @internal */
export { derivedStore } from './derivedStore';
/** @internal */
export { queryStore } from './queryStore';
/** @internal */
export { virtualStore } from './virtualStore';
/** @internal */
export { DEFAULT_STORAGE_KEY_PREFIX, getOptions, getStorageConfig, markStoreCreated } from './config';
/** @internal */
export { ensureError } from './errors';
/** @internal */
export { logger, setLogger } from './logger';
/** @internal */
export { StoreTags, assignStoreTag, hasDestroy } from './storeUtils';
