import { createQueryStore } from './createQueryStore';
import { createAsyncStorageMock, createSyncStorageMock } from './internal/storage/storageMocks.testUtils';

describe('createQueryStore PersistReturn types', () => {
  it('should return void for sync storage', () => {
    const store = createQueryStore(
      { fetcher: async () => ({ data: 'test' }) },
      { storage: createSyncStorageMock(), storageKey: 'test-query-sync' }
    );
    const result = store.setState({ enabled: false });
    const _typeCheck: void = result;
  });

  it('should return Promise<void> for async storage', () => {
    const store = createQueryStore(
      { fetcher: async () => ({ data: 'test' }) },
      { storage: createAsyncStorageMock(), storageKey: 'test-query-async' }
    );
    const result = store.setState({ enabled: false });
    const _typeCheck: Promise<void> = result;
  });

  it('should return void for non-persisted query stores', () => {
    const store = createQueryStore({
      fetcher: async () => ({ data: 'test' }),
    });
    const result = store.setState({ enabled: false });
    const _typeCheck: void = result;
  });

  it('should work with custom state and sync storage', () => {
    const store = createQueryStore({ fetcher: async () => ({ data: 'test' }) }, () => ({ customField: 'value' }), {
      storage: createSyncStorageMock(),
      storageKey: 'test-custom-sync',
    });
    const result = store.setState({ customField: 'new' });
    const _typeCheck: void = result;
  });

  it('should work with custom state and async storage', () => {
    const store = createQueryStore({ fetcher: async () => ({ data: 'test' }) }, () => ({ customField: 'value' }), {
      storage: createAsyncStorageMock(),
      storageKey: 'test-custom-async',
    });
    const result = store.setState({ customField: 'new' });
    const _typeCheck: Promise<void> = result;
  });
});
