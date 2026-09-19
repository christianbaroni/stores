import { createBaseStore } from './createBaseStore';
import { createAsyncStorageMock, createSyncStorageMock } from './internal/storage/storageMocks.testUtils';

describe('createBaseStore PersistReturn types', () => {
  it('should return void for sync storage', () => {
    const storage = createSyncStorageMock();
    const store = createBaseStore(() => ({ count: 0 }), {
      storage,
      storageKey: 'test-sync',
    });
    const result = store.setState(state => state);
    const _typeCheck: void = result;

    expect(storage.set).not.toHaveBeenCalled();
  });

  it('should return Promise<void> for async storage', () => {
    const storage = createAsyncStorageMock();
    const store = createBaseStore(() => ({ count: 0 }), {
      storage,
      storageKey: 'test-async',
    });
    const result = store.setState(state => state);
    const _typeCheck: Promise<void> = result;

    expect(result).toBeInstanceOf(Promise);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('should return void for non-persisted stores', () => {
    const store = createBaseStore(() => ({ count: 0 }));
    const result = store.setState({ count: 1 });
    const _typeCheck: void = result;
  });
});
