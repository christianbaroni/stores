/**
 * Type tests for PersistReturn handling across store creators.
 *
 * This file validates that sync and async storage adapters properly
 * flow through to setState return types.
 */

import { createBaseStore } from '../createBaseStore';
import { createQueryStore } from '../createQueryStore';
import { createVirtualStore } from '../createVirtualStore';
import { createAsyncStorageMock, createSyncStorageMock } from '../storage/tests/storageCreators.test';

// ============================================================================
// createBaseStore
// ============================================================================

describe('createBaseStore PersistReturn types', () => {
  it('should return void for sync storage', () => {
    const store = createBaseStore(() => ({ count: 0 }), {
      storage: createSyncStorageMock(),
      storageKey: 'test-sync',
    });

    // setState should return void
    const result = store.setState({ count: 1 });

    // Result should be void
    const _typeCheck: void = result;
  });

  it('should return Promise<void> for async storage', () => {
    const store = createBaseStore(() => ({ count: 0 }), {
      storage: createAsyncStorageMock(),
      storageKey: 'test-async',
    });

    // setState should return Promise<void>
    const result = store.setState({ count: 1 });

    // Result should be Promise<void>
    const _typeCheck: Promise<void> = result;
  });

  it('should return void for non-persisted stores', () => {
    const store = createBaseStore(() => ({ count: 0 }));

    const result = store.setState({ count: 1 });

    // Result should be void
    const _typeCheck: void = result;
  });
});

// ============================================================================
// createQueryStore
// ============================================================================

describe('createQueryStore PersistReturn types', () => {
  it('should return void for sync storage', () => {
    const store = createQueryStore(
      {
        fetcher: async () => ({ data: 'test' }),
      },
      {
        storage: createSyncStorageMock(),
        storageKey: 'test-query-sync',
      }
    );

    // setState should return void
    const result = store.setState({ enabled: false });

    // Result should be void
    const _typeCheck: void = result;
  });

  it('should return Promise<void> for async storage', () => {
    const store = createQueryStore(
      {
        fetcher: async () => ({ data: 'test' }),
      },
      {
        storage: createAsyncStorageMock(),
        storageKey: 'test-query-async',
      }
    );

    // setState should return Promise<void>
    const result = store.setState({ enabled: false });

    // Result should be Promise<void>
    const _typeCheck: Promise<void> = result;
  });

  it('should return void for non-persisted query stores', () => {
    const store = createQueryStore({
      fetcher: async () => ({ data: 'test' }),
    });

    const result = store.setState({ enabled: false });

    // Result should be void
    const _typeCheck: void = result;
  });

  it('should work with custom state and sync storage', () => {
    const store = createQueryStore(
      {
        fetcher: async () => ({ data: 'test' }),
      },
      () => ({ customField: 'value' }),
      {
        storage: createSyncStorageMock(),
        storageKey: 'test-custom-sync',
      }
    );

    const result = store.setState({ customField: 'new' });

    const _typeCheck: void = result;
  });

  it('should work with custom state and async storage', () => {
    const store = createQueryStore(
      {
        fetcher: async () => ({ data: 'test' }),
      },
      () => ({ customField: 'value' }),
      {
        storage: createAsyncStorageMock(),
        storageKey: 'test-custom-async',
      }
    );

    const result = store.setState({ customField: 'new' });

    const _typeCheck: Promise<void> = result;
  });
});

// ============================================================================
// createVirtualStore
// ============================================================================

describe('createVirtualStore PersistReturn types', () => {
  it('should preserve void return for sync persisted base stores', () => {
    const baseStore = createBaseStore(() => ({ count: 0 }), {
      storage: createSyncStorageMock(),
      storageKey: 'virtual-base-sync',
    });

    const virtualStore = createVirtualStore(() => baseStore);

    const result = virtualStore.setState({ count: 1 });

    // Should preserve void return type from base store
    const _typeCheck: void = result;
  });

  it('should preserve Promise<void> return for async persisted base stores', () => {
    const baseStore = createBaseStore(() => ({ count: 0 }), {
      storage: createAsyncStorageMock(),
      storageKey: 'virtual-base-async',
    });

    const virtualStore = createVirtualStore(() => baseStore);

    const result = virtualStore.setState({ count: 1 });

    // Should preserve Promise<void> return type from base store
    const _typeCheck: Promise<void> = result;
  });

  it('should preserve void for non-persisted stores', () => {
    const baseStore = createBaseStore(() => ({ count: 0 }));

    const virtualStore = createVirtualStore(() => baseStore);

    const result = virtualStore.setState({ count: 1 });

    // Should preserve void return type from base store
    const _typeCheck: void = result;
  });

  it('should work with query stores and sync storage', () => {
    const queryStore = createQueryStore(
      {
        fetcher: async () => ({ data: 'test' }),
      },
      {
        storage: createSyncStorageMock(),
        storageKey: 'virtual-query-sync',
      }
    );

    const virtualStore = createVirtualStore(() => queryStore);

    const result = virtualStore.setState({ enabled: false });

    // Should preserve void return type from query store
    const _typeCheck: void = result;
  });

  it('should work with query stores and async storage', () => {
    const queryStore = createQueryStore(
      {
        fetcher: async () => ({ data: 'test' }),
      },
      {
        storage: createAsyncStorageMock(),
        storageKey: 'virtual-query-async',
      }
    );

    const virtualStore = createVirtualStore(() => queryStore);

    const result = virtualStore.setState({ enabled: false });

    // Should preserve Promise<void> return type from query store
    const _typeCheck: Promise<void> = result;
  });
});
