import { IS_BROWSER } from '@env';
import { StoresError, logger } from '../logger';
import { SyncEngine, SyncHandle, SyncRegistration, SyncUpdate, SyncValues } from './types';

// ============ Browser Sync Engine ============================================ //

const CHANNEL_NAME = '@stores/core/sync-channel';
const STORAGE_EVENT_KEY = `${CHANNEL_NAME}:storage`;
const STORAGE_PREFIX = `${STORAGE_EVENT_KEY}:`;

type SyncEnvelope = {
  origin: string;
  replace: boolean;
  sessionId: string;
  storeKey: string;
  timestamp: number;
  values: Record<string, unknown>;
};

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Math.random().toString(36).slice(2)}:${Date.now().toString(36)}`;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

class BrowserSyncHandle<T extends Record<string, unknown>> implements SyncHandle<T> {
  private readonly broadcast: (envelope: SyncEnvelope) => void;
  private readonly origin: string;
  private readonly storeKey: string;
  private readonly teardown: () => void;

  constructor(params: { broadcast: (envelope: SyncEnvelope) => void; origin: string; storeKey: string; teardown: () => void }) {
    this.broadcast = params.broadcast;
    this.origin = params.origin;
    this.storeKey = params.storeKey;
    this.teardown = params.teardown;
  }

  destroy(): void {
    this.teardown();
  }

  publish(update: SyncUpdate<T>): void {
    const values: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(update.values)) {
      values[key] = value;
    }
    const payload: SyncEnvelope = {
      origin: this.origin,
      replace: update.replace,
      sessionId: update.sessionId,
      storeKey: this.storeKey,
      timestamp: update.timestamp,
      values,
    };
    this.broadcast(payload);
  }
}

type Listener = (envelope: SyncEnvelope) => void;

class BrowserSyncEngine implements SyncEngine {
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly origin = generateSessionId();
  private storage: Storage | null;

  constructor() {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    this.storage = getLocalStorage();
    if (this.channel) this.channel.addEventListener('message', this.onChannelMessage);
    if (IS_BROWSER) window.addEventListener('storage', this.onStorageEvent);
  }

  get sessionId(): string {
    return this.origin;
  }

  register<T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T> {
    const listener: Listener = envelope => {
      if (envelope.origin === this.origin || envelope.storeKey !== registration.key) return;
      const filteredValues: SyncValues<T> = Object.create(null);
      for (const key of registration.fields) {
        if (Object.prototype.hasOwnProperty.call(envelope.values, key)) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          filteredValues[key] = envelope.values[key] as SyncValues<T>[typeof key];
        }
      }
      if (!Object.keys(filteredValues).length) return;
      registration.apply({
        replace: envelope.replace,
        sessionId: envelope.sessionId,
        timestamp: envelope.timestamp,
        values: filteredValues,
      });
    };

    let listeners = this.listeners.get(registration.key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(registration.key, listeners);
    }
    listeners.add(listener);

    return new BrowserSyncHandle<T>({
      broadcast: envelope => this.broadcast(envelope),
      origin: this.origin,
      storeKey: registration.key,
      teardown: () => this.removeListener(registration.key, listener),
    });
  }

  private broadcast(envelope: SyncEnvelope): void {
    try {
      if (this.channel) this.channel.postMessage(envelope);
      this.writeToStorage(envelope);
    } catch (error) {
      logger.error(new StoresError('[sync] Failed to broadcast update'), { error });
    }
  }

  private onChannelMessage = (event: MessageEvent<SyncEnvelope>): void => {
    if (!event.data) return;
    this.dispatch(event.data);
  };

  private onStorageEvent = (event: StorageEvent): void => {
    if (!event.key || !event.newValue) return;
    if (!event.key.startsWith(STORAGE_PREFIX)) return;
    try {
      const envelope: SyncEnvelope = JSON.parse(event.newValue);
      this.dispatch(envelope);
    } catch (error) {
      logger.error(new StoresError('[sync] Failed to parse storage event payload'), { error });
    }
  };

  private dispatch(envelope: SyncEnvelope): void {
    if (!envelope.storeKey) return;
    const listeners = this.listeners.get(envelope.storeKey);
    if (!listeners || !listeners.size) return;
    for (const listener of listeners) listener(envelope);
  }

  private removeListener(storeKey: string, listener: Listener): void {
    const listeners = this.listeners.get(storeKey);
    if (!listeners) return;
    listeners.delete(listener);
    if (!listeners.size) this.listeners.delete(storeKey);
  }

  private writeToStorage(envelope: SyncEnvelope): void {
    if (!this.storage) this.storage = getLocalStorage();
    if (!this.storage) return;
    const storageKey = `${STORAGE_PREFIX}${envelope.storeKey}`;
    try {
      this.storage.setItem(storageKey, JSON.stringify(envelope));
    } catch (error) {
      logger.error(new StoresError('[sync] Failed to write broadcast payload to storage'), { error });
    }
  }
}

const sharedEngine = IS_BROWSER ? new BrowserSyncEngine() : null;

export function createBrowserSyncEngine(): SyncEngine {
  return sharedEngine ?? new BrowserSyncEngine();
}
