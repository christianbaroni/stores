/**
 * @jest-environment node
 */

import { createBaseStore } from './createBaseStore';
import { createVirtualStore } from './createVirtualStore';
import { createAsyncStorageMock, createSyncStorageMock } from './storage/tests/storageCreators.test';

describe('createVirtualStore', () => {
  describe('Async Storage Support', () => {
    it('should support async storage with Promise<void> return type for setState', async () => {
      const mockAsyncStorage = createAsyncStorageMock();

      // Create a base store with async storage
      const baseStore = createBaseStore(() => ({ count: 0 }), {
        storageKey: 'async-base-store',
        storage: mockAsyncStorage,
      });

      // Create a virtual store wrapping the async base store
      const virtualStore = createVirtualStore(() => baseStore);

      // Verify setState returns Promise<void> for async storage
      const setStateResult = virtualStore.setState({ count: 5 });
      expect(setStateResult).toBeInstanceOf(Promise);
      await setStateResult;

      // Verify storage was called
      expect(mockAsyncStorage.set).toHaveBeenCalled();
      expect(virtualStore.getState().count).toBe(5);
    });

    it('should support sync storage with void return type for setState', async () => {
      const mockSyncStorage = createSyncStorageMock();

      // Create a base store with sync storage
      const baseStore = createBaseStore(() => ({ count: 0 }), {
        storageKey: 'sync-base-store',
        storage: mockSyncStorage,
      });

      // Create a virtual store wrapping the sync base store
      const virtualStore = createVirtualStore(() => baseStore);

      // Verify setState returns void for sync storage
      const setStateResult = virtualStore.setState({ count: 5 });
      expect(setStateResult).toBe(void 0);

      // Verify storage was called
      expect(mockSyncStorage.set).toHaveBeenCalled();
      expect(virtualStore.getState().count).toBe(5);
    });
  });
});
