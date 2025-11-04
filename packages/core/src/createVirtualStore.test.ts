/**
 * @jest-environment node
 */

import { createBaseStore } from './createBaseStore';
import { createVirtualStore } from './createVirtualStore';
import { waitForMicrotask } from './utils/time';

describe('createVirtualStore', () => {
  describe('Async Storage Support', () => {
    it('should support async storage with Promise<void> return type for setState', async () => {
      const mockStorage: Record<string, string> = {};

      const mockAsyncStorage: {
        async: true;
        clearAll: jest.Mock<Promise<void>, []>;
        contains: jest.Mock<Promise<boolean>, [string]>;
        delete: jest.Mock<Promise<void>, [string]>;
        getAllKeys: jest.Mock<Promise<string[]>, []>;
        getString: jest.Mock<Promise<string | undefined>, [string]>;
        set: jest.Mock<Promise<void>, [string, string]>;
      } = {
        async: true,
        clearAll: jest.fn(async () => {
          return;
        }),
        contains: jest.fn(async (key: string) => {
          return key in mockStorage;
        }),
        delete: jest.fn(async (key: string) => {
          delete mockStorage[key];
        }),
        getAllKeys: jest.fn(async () => {
          return Object.keys(mockStorage);
        }),
        getString: jest.fn(async (key: string) => {
          return mockStorage[key];
        }),
        set: jest.fn(async (key: string, value: string) => {
          mockStorage[key] = value;
        }),
      };

      // Create a base store with async storage
      const baseStore = createBaseStore(() => ({ count: 0 }), {
        storageKey: 'async-base-store',
        storage: mockAsyncStorage,
      });

      // Wait for hydration to complete before testing setState
      if (baseStore.persist && !baseStore.persist.hasHydrated()) {
        await new Promise<void>(resolve => {
          baseStore.persist?.onFinishHydration(() => {
            resolve();
          });
        });
      }

      // Create a virtual store wrapping the async base store
      const virtualStore = createVirtualStore<typeof baseStore, Partial<{ count: number }>, Promise<void>>(() => baseStore);

      // Verify setState returns Promise<void> for async storage
      const setStateResult = virtualStore.setState({ count: 5 });
      expect(setStateResult).toBeInstanceOf(Promise);
      await setStateResult;

      // Allow persistence to complete (async storage uses microtask scheduler)
      await waitForMicrotask();

      // Verify storage was called
      expect(mockAsyncStorage.set).toHaveBeenCalled();
      expect(virtualStore.getState().count).toBe(5);
    });

    it('should support sync storage with void return type for setState', async () => {
      const mockStorage: Record<string, string> = {};

      const mockSyncStorage: {
        async?: false;
        clearAll: jest.Mock<void, []>;
        contains: jest.Mock<boolean, [string]>;
        delete: jest.Mock<void, [string]>;
        getAllKeys: jest.Mock<string[], []>;
        getString: jest.Mock<string | undefined, [string]>;
        set: jest.Mock<void, [string, string]>;
      } = {
        async: false,
        clearAll: jest.fn(() => {
          Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        }),
        contains: jest.fn((key: string) => {
          return key in mockStorage;
        }),
        delete: jest.fn((key: string) => {
          delete mockStorage[key];
        }),
        getAllKeys: jest.fn(() => {
          return Object.keys(mockStorage);
        }),
        getString: jest.fn((key: string) => {
          return mockStorage[key];
        }),
        set: jest.fn((key: string, value: string) => {
          mockStorage[key] = value;
        }),
      };

      // Create a base store with sync storage
      const baseStore = createBaseStore(() => ({ count: 0 }), {
        storageKey: 'sync-base-store',
        storage: mockSyncStorage,
      });

      // Wait for hydration to complete before testing setState
      if (baseStore.persist && !baseStore.persist.hasHydrated()) {
        await new Promise<void>(resolve => {
          baseStore.persist?.onFinishHydration(() => {
            resolve();
          });
        });
      }

      // Create a virtual store wrapping the sync base store
      const virtualStore = createVirtualStore(() => baseStore);

      // Verify setState returns void for sync storage
      const setStateResult = virtualStore.setState({ count: 5 });
      expect(setStateResult).toBeUndefined();

      // Allow persistence to complete (sync storage may throttle)
      await waitForMicrotask();

      // Verify storage was called
      expect(mockSyncStorage.set).toHaveBeenCalled();
      expect(virtualStore.getState().count).toBe(5);
    });
  });
});
