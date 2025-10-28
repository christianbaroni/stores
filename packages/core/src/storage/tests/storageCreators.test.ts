/**
 * @jest-environment node
 */

import { createPersistStorage } from '../../storage/storageCreators';
import { SyncContext } from '../../sync/syncEnhancer';
import { createMockSyncContext } from '../../sync/tests/testUtils';

type SyncStorageMock = {
  getString: jest.Mock<string | undefined, [string]>;
  set: jest.Mock<void, [string, string]>;
  delete: jest.Mock<void, [string]>;
  clearAll: jest.Mock<void, []>;
  contains: jest.Mock<boolean, [string]>;
  getAllKeys: jest.Mock<string[], []>;
  async: false;
};

type AsyncStorageMock = {
  getString: jest.Mock<Promise<string | undefined>, [string]>;
  set: jest.Mock<Promise<void>, [string, string]>;
  delete: jest.Mock<Promise<void>, [string]>;
  clearAll: jest.Mock<Promise<void>, []>;
  contains: jest.Mock<Promise<boolean>, [string]>;
  getAllKeys: jest.Mock<Promise<string[]>, []>;
  async: true;
};

function createSyncStorageMock(): SyncStorageMock {
  return {
    getString: jest.fn<string | undefined, [string]>(),
    set: jest.fn<void, [string, string]>(),
    delete: jest.fn<void, [string]>(),
    clearAll: jest.fn<void, []>(),
    contains: jest.fn<boolean, [string]>(),
    getAllKeys: jest.fn<string[], []>(),
    async: false,
  };
}

function createAsyncStorageMock(): AsyncStorageMock {
  return {
    getString: jest.fn<Promise<string | undefined>, [string]>(async () => undefined),
    set: jest.fn<Promise<void>, [string, string]>(async () => {}),
    delete: jest.fn<Promise<void>, [string]>(async () => {}),
    clearAll: jest.fn<Promise<void>, []>(async () => {}),
    contains: jest.fn<Promise<boolean>, [string]>(async () => false),
    getAllKeys: jest.fn<Promise<string[]>, []>(async () => []),
    async: true,
  };
}

function createContext(overrides: Partial<SyncContext> = {}): {
  context: SyncContext;
  fields: Record<string, number>;
  clearSpy: jest.Mock<void, [Record<string, number> | undefined]>;
} {
  const { context, fieldTimestamps } = createMockSyncContext({
    isAsync: overrides.isAsync ?? false,
    getIsApplyingRemote: overrides.getIsApplyingRemote,
    getSessionId: overrides.getSessionId ?? (() => 'session-id'),
    getTimestamp: overrides.getTimestamp ?? (() => 1000),
    mergeFieldTimestamps: overrides.mergeFieldTimestamps,
    clearFieldTimestamps: overrides.clearFieldTimestamps,
  });

  const originalClear = context.clearFieldTimestamps;
  const clearSpy = jest.fn((snapshot: Record<string, number> | undefined) => {
    originalClear?.(snapshot);
  });
  context.clearFieldTimestamps = clearSpy;

  return { context, fields: fieldTimestamps, clearSpy };
}

describe('createPersistStorage', () => {
  describe('synchronous storage', () => {
    it('embeds sync metadata and clears snapshots after persist', () => {
      const storage = createSyncStorageMock();
      const { context, fields, clearSpy } = createContext();
      fields.count = 1234;

      const { persistStorage } = createPersistStorage<{ count: number }, { count: number }, void>(
        { storageKey: 'counter', sync: { injectStorageMetadata: true } },
        storage,
        context
      );

      persistStorage.setItem('counter', { state: { count: 5 }, version: 0 });

      expect(storage.set).toHaveBeenCalledTimes(1);
      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toEqual({
        origin: 'session-id',
        timestamp: 1000,
        fields: { count: 1234 },
      });
      expect(fields).toEqual({});
      expect(clearSpy).toHaveBeenCalledWith({ count: 1234 });
    });

    it('skips persistence when applying remote update', () => {
      const storage = createSyncStorageMock();
      const { context } = createContext({
        getIsApplyingRemote: () => true,
      });

      const { persistStorage } = createPersistStorage<{ value: string }, { value: string }, void>(
        { storageKey: 'test', sync: { injectStorageMetadata: true } },
        storage,
        context
      );

      persistStorage.setItem('test', { state: { value: 'ignore' }, version: 0 });
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('omits metadata when injection is disabled', () => {
      const storage = createSyncStorageMock();
      const { context, fields, clearSpy } = createContext();
      fields.count = 4321;

      const { persistStorage } = createPersistStorage<{ count: number }, { count: number }, void>(
        {
          storageKey: 'counter',
          sync: true,
        },
        storage,
        context
      );

      persistStorage.setItem('counter', { state: { count: 7 }, version: 0 });

      expect(storage.set).toHaveBeenCalledTimes(1);
      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toBeUndefined();
      expect(fields).toEqual({ count: 4321 });
      expect(clearSpy).not.toHaveBeenCalled();
    });

    it('does not clear snapshots when metadata is empty', () => {
      const storage = createSyncStorageMock();
      const { context, fields: _, clearSpy } = createContext();

      const { persistStorage } = createPersistStorage<{ count: number }, { count: number }, void>(
        { storageKey: 'counter', sync: { injectStorageMetadata: true } },
        storage,
        context
      );

      persistStorage.setItem('counter', { state: { count: 1 }, version: 0 });

      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toEqual({ origin: 'session-id', timestamp: 1000 });
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });

  describe('asynchronous storage', () => {
    it('embeds metadata for async storage and clears snapshots after success', async () => {
      const storage = createAsyncStorageMock();
      const { context, fields, clearSpy } = createContext({ isAsync: true, getTimestamp: () => 2000 });
      fields.items = 2000;

      const { persistStorage } = createPersistStorage<{ items: string[] }, { items: string[] }, Promise<void>>(
        { storageKey: 'items', sync: { injectStorageMetadata: true } },
        storage,
        context
      );

      await persistStorage.setItem('items', { state: { items: ['a'] }, version: 1 });

      expect(storage.set).toHaveBeenCalledTimes(1);
      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toEqual({
        origin: 'session-id',
        timestamp: 2000,
        fields: { items: 2000 },
      });
      expect(fields).toEqual({});
      expect(clearSpy).toHaveBeenCalledWith({ items: 2000 });
    });

    it('skips async persistence when applying remote update', async () => {
      const storage = createAsyncStorageMock();
      const { context } = createContext({ isAsync: true, getIsApplyingRemote: () => true });

      const { persistStorage } = createPersistStorage<{ ok: boolean }, { ok: boolean }, Promise<void>>(
        { storageKey: 'async-skip', sync: { injectStorageMetadata: true } },
        storage,
        context
      );

      await persistStorage.setItem('async-skip', { state: { ok: true }, version: 0 });
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('omits metadata when injection is disabled for async storage', async () => {
      const storage = createAsyncStorageMock();
      const { context, fields, clearSpy } = createContext({ isAsync: true });
      fields.count = 9999;

      const { persistStorage } = createPersistStorage<{ count: number }, { count: number }, Promise<void>>(
        {
          storageKey: 'async-counter',
          sync: true,
        },
        storage,
        context
      );

      await persistStorage.setItem('async-counter', { state: { count: 2 }, version: 0 });

      expect(storage.set).toHaveBeenCalledTimes(1);
      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toBeUndefined();
      expect(fields).toEqual({ count: 9999 });
      expect(clearSpy).not.toHaveBeenCalled();
    });

    it('retains snapshot when metadata is not embedded', async () => {
      const storage = createAsyncStorageMock();
      const { context, clearSpy } = createContext({ isAsync: true });

      const { persistStorage } = createPersistStorage<{ value: number }, { value: number }, Promise<void>>(
        { storageKey: 'no-fields', sync: { injectStorageMetadata: true } },
        storage,
        context
      );

      await persistStorage.setItem('no-fields', { state: { value: 1 }, version: 0 });

      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toEqual({ origin: 'session-id', timestamp: 1000 });
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });
});
