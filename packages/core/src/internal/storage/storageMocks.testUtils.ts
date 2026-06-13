import { type Mock } from 'vitest';

export type SyncStorageMock = {
  get: Mock<(key: string) => string | undefined>;
  set: Mock<(key: string, value: string) => void>;
  delete: Mock<(key: string) => void>;
  clearAll: Mock<() => void>;
  contains: Mock<(key: string) => boolean>;
  getAllKeys: Mock<() => string[]>;
  async: false;
};

export type AsyncStorageMock = {
  get: Mock<(key: string) => Promise<string | undefined>>;
  set: Mock<(key: string, value: string) => Promise<void>>;
  delete: Mock<(key: string) => Promise<void>>;
  clearAll: Mock<() => Promise<void>>;
  contains: Mock<(key: string) => Promise<boolean>>;
  getAllKeys: Mock<() => Promise<string[]>>;
  async: true;
};

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
