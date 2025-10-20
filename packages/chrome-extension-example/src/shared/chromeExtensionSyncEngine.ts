import type { SyncEngine, SyncHandle, SyncRegistration, SyncUpdate, SyncValues } from '@stores';

export type ChromeExtensionSyncEngineOptions = {
  namespace?: string;
};

const MESSAGE_TYPE = '@stores/chrome-extension-sync';

type SyncMessage = {
  namespace: string;
  origin: string;
  payload: {
    replace: boolean;
    storeKey: string;
    timestamp: number;
    values: Record<string, unknown>;
  };
  type: typeof MESSAGE_TYPE;
};

type RegistrationContainer = {
  registration: SyncRegistration<Record<string, unknown>>;
};

function getRuntimeError(): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) return null;
  return new Error(chrome.runtime.lastError.message);
}

function isRuntimeAvailable(): typeof chrome.runtime | null {
  return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null;
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Math.random().toString(36).slice(2)}:${Date.now().toString(36)}`;
}

export class ChromeExtensionSyncEngine implements SyncEngine {
  private readonly namespace: string;
  private readonly origin: string;
  private readonly registrations = new Map<string, RegistrationContainer>();
  private isListening = false;

  constructor(options?: ChromeExtensionSyncEngineOptions) {
    this.namespace = options?.namespace ?? '@stores/chrome-extension-sync';
    this.origin = generateSessionId();
    this.attachListener();
  }

  register<T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T> {
    this.attachListener();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    this.registrations.set(registration.key, { registration } as RegistrationContainer);

    return {
      destroy: () => {
        this.registrations.delete(registration.key);
        if (!this.registrations.size) this.detachListener();
      },
      hydrated: () => true,
      onHydrated: callback => {
        callback();
      },
      publish: update => {
        this.publishUpdate(registration.key, update);
      },
    };
  }

  private attachListener(): void {
    const runtime = isRuntimeAvailable();
    if (!runtime || this.isListening) return;
    runtime.onMessage.addListener(this.onMessage);
    this.isListening = true;
  }

  private detachListener(): void {
    const runtime = isRuntimeAvailable();
    if (!runtime || !this.isListening) return;
    runtime.onMessage.removeListener(this.onMessage);
    this.isListening = false;
  }

  private publishUpdate<T extends Record<string, unknown>>(storeKey: string, update: SyncUpdate<T>): void {
    const runtime = isRuntimeAvailable();
    if (!runtime) return;

    const message: SyncMessage = {
      namespace: this.namespace,
      origin: this.origin,
      payload: {
        replace: update.replace,
        storeKey,
        timestamp: update.timestamp,
        values: { ...update.values },
      },
      type: MESSAGE_TYPE,
    };

    runtime.sendMessage(message, () => {
      // Ignore chrome.runtime.lastError to suppress expected "no receiver" errors
      // This is normal when no other extension contexts are listening
      void getRuntimeError();
    });
  }

  private onMessage = (
    rawMessage: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse?: (response?: unknown) => void
  ): boolean => {
    if (!this.isSyncMessage(rawMessage)) return false;
    if (rawMessage.namespace !== this.namespace) return false;
    if (rawMessage.origin === this.origin) return false;

    const container = this.registrations.get(rawMessage.payload.storeKey);
    if (!container) return false;

    const filteredValues: SyncValues<Record<string, unknown>> = {};
    for (const field of container.registration.fields) {
      if (Object.prototype.hasOwnProperty.call(rawMessage.payload.values, field)) {
        filteredValues[field] = rawMessage.payload.values[field];
      }
    }

    if (!Object.keys(filteredValues).length && !rawMessage.payload.replace) return false;

    container.registration.apply({
      replace: rawMessage.payload.replace,
      timestamp: rawMessage.payload.timestamp,
      values: filteredValues,
    });

    // Acknowledge receipt synchronously
    if (sendResponse) {
      sendResponse({ received: true });
    }
    return false;
  };

  private isSyncMessage(message: unknown): message is SyncMessage {
    if (typeof message !== 'object' || message === null) return false;
    const candidate: Partial<SyncMessage> = message;
    if (candidate.type !== MESSAGE_TYPE) return false;
    if (typeof candidate.namespace !== 'string' || typeof candidate.origin !== 'string') return false;
    if (!candidate.payload || typeof candidate.payload !== 'object') return false;
    const { payload } = candidate;
    return (
      typeof payload.storeKey === 'string' &&
      typeof payload.timestamp === 'number' &&
      typeof payload.replace === 'boolean' &&
      typeof payload.values === 'object' &&
      payload.values !== null
    );
  }
}
