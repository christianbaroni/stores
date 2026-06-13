import { createBaseStore } from './createBaseStore';
import { createQueryStore } from './createQueryStore';
import { createVirtualStore } from './createVirtualStore';
import { createAsyncStorageMock, createSyncStorageMock } from './internal/storage/storageMocks.testUtils';

describe('createVirtualStore PersistReturn types', () => {
  it('should preserve void return for sync persisted base stores', () => {
    const baseStore = createBaseStore(() => ({ count: 0 }), {
      storage: createSyncStorageMock(),
      storageKey: 'virtual-base-sync',
    });
    const virtualStore = createVirtualStore(() => baseStore);
    const result = virtualStore.setState({ count: 1 });

    const _typeCheck: void = result;
  });

  it('should preserve Promise<void> return for async persisted base stores', () => {
    const baseStore = createBaseStore(() => ({ count: 0 }), {
      storage: createAsyncStorageMock(),
      storageKey: 'virtual-base-async',
    });
    const virtualStore = createVirtualStore(() => baseStore);
    const result = virtualStore.setState({ count: 1 });

    const _typeCheck: Promise<void> = result;
  });

  it('should preserve void for non-persisted stores', () => {
    const baseStore = createBaseStore(() => ({ count: 0 }));
    const virtualStore = createVirtualStore(() => baseStore);
    const result = virtualStore.setState({ count: 1 });

    const _typeCheck: void = result;
  });

  it('should work with query stores and sync storage', () => {
    const queryStore = createQueryStore(
      { fetcher: async () => ({ data: 'test' }) },
      { storage: createSyncStorageMock(), storageKey: 'virtual-query-sync' }
    );
    const virtualStore = createVirtualStore(() => queryStore);
    const result = virtualStore.setState({ enabled: false });

    const _typeCheck: void = result;
  });

  it('should work with query stores and async storage', () => {
    const queryStore = createQueryStore(
      { fetcher: async () => ({ data: 'test' }) },
      { storage: createAsyncStorageMock(), storageKey: 'virtual-query-async' }
    );
    const virtualStore = createVirtualStore(() => queryStore);
    const result = virtualStore.setState({ enabled: false });

    const _typeCheck: Promise<void> = result;
  });
});
