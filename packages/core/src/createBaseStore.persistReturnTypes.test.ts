import { createBaseStore } from './createBaseStore';
import { createAsyncStorageMock, createSyncStorageMock } from './internal/storage/storageMocks.testUtils';

describe('createBaseStore PersistReturn types', () => {
  it('should return void for sync storage', () => {
    const store = createBaseStore(() => ({ count: 0 }), {
      storage: createSyncStorageMock(),
      storageKey: 'test-sync',
    });
    const result = store.setState({ count: 1 });
    const _typeCheck: void = result;
  });

  it('should return Promise<void> for async storage', () => {
    const store = createBaseStore(() => ({ count: 0 }), {
      storage: createAsyncStorageMock(),
      storageKey: 'test-async',
    });
    const result = store.setState({ count: 1 });
    const _typeCheck: Promise<void> = result;
  });

  it('should return void for non-persisted stores', () => {
    const store = createBaseStore(() => ({ count: 0 }));
    const result = store.setState({ count: 1 });
    const _typeCheck: void = result;
  });
});
