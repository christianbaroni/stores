import { type Mock } from 'vitest';
import { createPersistStorage } from '../../storage/storageCreators';
import { SyncContext } from '../../sync/syncEnhancer';
import { createSyncContextMock } from '../../tests/syncContext';

type SyncStorageMock = {
  get: Mock<(key: string) => string | undefined>;
  set: Mock<(key: string, value: string) => void>;
  delete: Mock<(key: string) => void>;
  clearAll: Mock<() => void>;
  contains: Mock<(key: string) => boolean>;
  getAllKeys: Mock<() => string[]>;
  async: false;
};

type AsyncStorageMock = {
  get: Mock<(key: string) => Promise<string | undefined>>;
  set: Mock<(key: string, value: string) => Promise<void>>;
  delete: Mock<(key: string) => Promise<void>>;
  clearAll: Mock<() => Promise<void>>;
  contains: Mock<(key: string) => Promise<boolean>>;
  getAllKeys: Mock<() => Promise<string[]>>;
  async: true;
};

/**
 * Creates a synchronous storage mock with `vi.fn()` methods.
 */
export function createSyncStorageMock(): SyncStorageMock {
  return {
    get: vi.fn<(key: string) => string | undefined>(),
    set: vi.fn<(key: string, value: string) => void>(),
    delete: vi.fn<(key: string) => void>(),
    clearAll: vi.fn<() => void>(),
    contains: vi.fn<(key: string) => boolean>(),
    getAllKeys: vi.fn<() => string[]>(),
    async: false,
  };
}

/**
 * Creates an asynchronous storage mock with `vi.fn()` methods.
 */
export function createAsyncStorageMock(): AsyncStorageMock {
  return {
    get: vi.fn<(key: string) => Promise<string | undefined>>(async () => undefined),
    set: vi.fn<(key: string, value: string) => Promise<void>>(async () => {}),
    delete: vi.fn<(key: string) => Promise<void>>(async () => {}),
    clearAll: vi.fn<() => Promise<void>>(async () => {}),
    contains: vi.fn<(key: string) => Promise<boolean>>(async () => false),
    getAllKeys: vi.fn<() => Promise<string[]>>(async () => []),
    async: true,
  };
}

function createContext(overrides: Partial<SyncContext> = {}): {
  context: SyncContext;
  fields: Record<string, number>;
  clearSpy: Mock<(snapshot: Record<string, number> | undefined) => void>;
} {
  const { context, fieldTimestamps } = createSyncContextMock({
    isAsync: overrides.isAsync ?? false,
    getIsApplyingRemote: overrides.getIsApplyingRemote,
    getSessionId: overrides.getSessionId ?? (() => 'session-id'),
    getTimestamp: overrides.getTimestamp ?? (() => 1000),
    mergeFieldTimestamps: overrides.mergeFieldTimestamps,
    clearFieldTimestamps: overrides.clearFieldTimestamps,
  });

  const originalClear = context.clearFieldTimestamps;
  const clearSpy = vi.fn((snapshot: Record<string, number> | undefined) => {
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

      persistStorage.setItem('counter', { count: 5 }, 0);

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

      persistStorage.setItem('test', { value: 'ignore' }, 0);
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

      persistStorage.setItem('counter', { count: 7 }, 0);

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

      persistStorage.setItem('counter', { count: 1 }, 0);

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

      await persistStorage.setItem('items', { items: ['a'] }, 1);

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

      await persistStorage.setItem('async-skip', { ok: true }, 0);
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

      await persistStorage.setItem('async-counter', { count: 2 }, 0);

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

      await persistStorage.setItem('no-fields', { value: 1 }, 0);

      const serialized = JSON.parse(storage.set.mock.calls[0][1]);
      expect(serialized.syncMetadata).toEqual({ origin: 'session-id', timestamp: 1000 });
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });
});
