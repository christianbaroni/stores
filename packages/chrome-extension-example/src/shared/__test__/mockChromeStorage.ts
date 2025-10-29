/// <reference types="chrome" />

/**
 * Mock implementation of Chrome Storage API
 * Simulates a single shared storage area that can be used across multiple "processes"
 */

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: 'local' | 'session' | 'sync' | 'managed'
) => void;

class MockStorageArea {
  private data: Record<string, unknown> = {};
  private listeners: Set<StorageChangeListener> = new Set();

  constructor(
    private readonly areaName: 'local' | 'session' | 'sync' | 'managed',
    private readonly onChanged: {
      addListener: (callback: StorageChangeListener) => void;
      removeListener: (callback: StorageChangeListener) => void;
    }
  ) {}

  get(
    keys?: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void
  ): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
      let result: Record<string, unknown> = {};

      if (keys === null || keys === undefined) {
        // Return all items
        result = { ...this.data };
      } else if (typeof keys === 'string') {
        // Single key
        if (keys in this.data) {
          result[keys] = this.data[keys];
        }
      } else if (Array.isArray(keys)) {
        // Array of keys
        for (const key of keys) {
          if (key in this.data) {
            result[key] = this.data[key];
          }
        }
      } else {
        // Object with default values
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = key in this.data ? this.data[key] : defaultValue;
        }
      }

      if (callback) {
        callback(result);
      }
      resolve(result);
    });
  }

  set(items: Record<string, unknown>, callback?: () => void): Promise<void> {
    return new Promise(resolve => {
      const changes: Record<string, chrome.storage.StorageChange> = {};

      for (const [key, newValue] of Object.entries(items)) {
        const oldValue = this.data[key];
        this.data[key] = newValue;

        changes[key] = {
          oldValue,
          newValue,
        };
      }

      // Notify listeners asynchronously (simulating Chrome's behavior)
      queueMicrotask(() => {
        this.listeners.forEach(listener => {
          listener(changes, this.areaName);
        });
      });

      if (callback) {
        callback();
      }
      resolve();
    });
  }

  remove(keys: string | string[], callback?: () => void): Promise<void> {
    return new Promise(resolve => {
      const keysArray = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, chrome.storage.StorageChange> = {};

      for (const key of keysArray) {
        if (key in this.data) {
          changes[key] = {
            oldValue: this.data[key],
            newValue: undefined,
          };
          delete this.data[key];
        }
      }

      // Notify listeners asynchronously
      if (Object.keys(changes).length > 0) {
        queueMicrotask(() => {
          this.listeners.forEach(listener => {
            listener(changes, this.areaName);
          });
        });
      }

      if (callback) {
        callback();
      }
      resolve();
    });
  }

  clear(callback?: () => void): Promise<void> {
    return new Promise(resolve => {
      const changes: Record<string, chrome.storage.StorageChange> = {};

      for (const [key, oldValue] of Object.entries(this.data)) {
        changes[key] = {
          oldValue,
          newValue: undefined,
        };
      }

      this.data = {};

      // Notify listeners asynchronously
      if (Object.keys(changes).length > 0) {
        queueMicrotask(() => {
          this.listeners.forEach(listener => {
            listener(changes, this.areaName);
          });
        });
      }

      if (callback) {
        callback();
      }
      resolve();
    });
  }

  getBytesInUse(keys?: string | string[] | null, callback?: (bytesInUse: number) => void): Promise<number> {
    return new Promise(resolve => {
      // Simple mock implementation
      const bytesInUse = JSON.stringify(this.data).length;
      if (callback) {
        callback(bytesInUse);
      }
      resolve(bytesInUse);
    });
  }

  setAccessLevel(accessOptions: { accessLevel: chrome.storage.AccessLevel }, callback?: () => void): Promise<void> {
    return new Promise(resolve => {
      if (callback) {
        callback();
      }
      resolve();
    });
  }

  registerListener(listener: StorageChangeListener): void {
    this.listeners.add(listener);
  }

  unregisterListener(listener: StorageChangeListener): void {
    this.listeners.delete(listener);
  }
}

export class MockChromeStorage {
  private localArea: MockStorageArea;
  private sessionArea: MockStorageArea;
  private syncArea: MockStorageArea;
  private managedArea: MockStorageArea;
  private changeListeners: Set<StorageChangeListener> = new Set();

  constructor() {
    // Create a simpler onChanged object that doesn't cause circular registration
    const onChanged = {
      addListener: (callback: StorageChangeListener) => {
        this.changeListeners.add(callback);
      },
      removeListener: (callback: StorageChangeListener) => {
        this.changeListeners.delete(callback);
      },
    };

    this.localArea = new MockStorageArea('local', onChanged);
    this.sessionArea = new MockStorageArea('session', onChanged);
    this.syncArea = new MockStorageArea('sync', onChanged);
    this.managedArea = new MockStorageArea('managed', onChanged);
  }

  cleanup(): void {
    // Clear all listeners to prevent leaks
    this.changeListeners.clear();
  }

  get local(): chrome.storage.StorageArea {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.localArea as unknown as chrome.storage.StorageArea;
  }

  get session(): chrome.storage.StorageArea {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.sessionArea as unknown as chrome.storage.StorageArea;
  }

  get sync(): chrome.storage.StorageArea {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.syncArea as unknown as chrome.storage.StorageArea;
  }

  get managed(): chrome.storage.StorageArea {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return this.managedArea as unknown as chrome.storage.StorageArea;
  }

  get onChanged(): chrome.storage.StorageChangedEvent {
    // Arrow functions preserve 'this' context, avoiding the need for aliasing
    // Type assertion is required to match Chrome's StorageChangedEvent interface which includes Event properties
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return {
      addListener: (callback: StorageChangeListener) => {
        this.changeListeners.add(callback);
        this.localArea.registerListener(callback);
        this.sessionArea.registerListener(callback);
        this.syncArea.registerListener(callback);
        this.managedArea.registerListener(callback);
      },
      removeListener: (callback: StorageChangeListener) => {
        this.changeListeners.delete(callback);
        this.localArea.unregisterListener(callback);
        this.sessionArea.unregisterListener(callback);
        this.syncArea.unregisterListener(callback);
        this.managedArea.unregisterListener(callback);
      },
      hasListener: (callback: StorageChangeListener) => {
        return this.changeListeners.has(callback);
      },
      hasListeners: () => {
        return this.changeListeners.size > 0;
      },
      getRules: () => {
        throw new Error('Not implemented');
      },
      addRules: () => {
        throw new Error('Not implemented');
      },
      removeRules: () => {
        throw new Error('Not implemented');
      },
    } as chrome.storage.StorageChangedEvent;
  }
}

export const setupMockChrome = (storage: MockChromeStorage): void => {
  // Mocking global chrome object for testing purposes
  // Type assertions are necessary to mock the complex Chrome API types
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  global.chrome = {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    storage: storage as unknown as typeof chrome.storage,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    runtime: {
      lastError: undefined,
    } as typeof chrome.runtime,
  } as typeof chrome;
};

export const cleanupMockChrome = (): void => {
  // @ts-expect-error - Cleaning up global chrome object
  delete global.chrome;
};
