import { SyncAuthPayload, SyncUpdate } from './types';

// ============ Transport Types ================================================ //

/**
 * ### `SyncTransportMessage`
 *
 * Message envelope for sync engine communication over a transport layer.
 * Supports sync updates and presence coordination.
 */
export type SyncTransportMessage<T extends Record<string, unknown> = Record<string, unknown>> =
  | PingMessage
  | {
      type: 'sync-update';
      storeKey: string;
      update: SyncUpdate<T>;
    }
  | {
      type: 'auth-challenge';
      code: string;
      message?: string;
    }
  | {
      type: 'auth-error';
      code: string;
      message?: string;
    }
  | {
      type: 'presence-join';
      storeKey: string;
      userId: string;
      userData?: unknown;
    }
  | {
      type: 'presence-leave';
      storeKey: string;
      userId: string;
    }
  | {
      type: 'presence-update';
      storeKey: string;
      userId: string;
      userData: unknown;
    };

export type PingMessage = { readonly type: 'ping' } | { readonly type: 'pong' };

/**
 * ### `SyncTransport`
 *
 * Abstract transport interface for network-based sync engines.
 * Implementations can use WebSockets, SSE, HTTP long-polling, or any other
 * bidirectional communication protocol.
 *
 * @example
 * ```typescript
 * const transport = new WebSocketTransport('ws://localhost:3000');
 * await transport.connect();
 *
 * transport.onMessage(message => {
 *   if (message.type === 'sync-update') {
 *     // Handle update
 *   }
 * });
 *
 * transport.send({
 *   type: 'sync-update',
 *   storeKey: 'my-store',
 *   update: { ... }
 * });
 * ```
 */
export interface SyncTransport {
  /**
   * Establishes connection to the transport endpoint.
   * @throws {Error} If connection fails
   */
  connect(options?: SyncTransportConnectOptions): Promise<void>;

  /**
   * Closes the transport connection and cleans up resources.
   */
  disconnect(): void;

  /**
   * Sends a message through the transport.
   * Messages sent while disconnected may be queued or dropped depending on implementation.
   *
   * @param message - The message to send
   */
  send(message: SyncTransportMessage): void;

  /**
   * Registers a handler for incoming messages.
   * Only one handler can be registered at a time; subsequent calls replace the previous handler.
   *
   * @param handler - Function to call when messages arrive
   */
  onMessage(handler: (message: SyncTransportMessage) => void): void;

  /**
   * Registers a handler for connection state changes.
   *
   * @param handler - Function to call when connection state changes
   */
  onConnectionChange(handler: (connected: boolean) => void): void;

  /**
   * Updates the active authentication payload. Transports may choose to
   * reconnect automatically or apply the metadata lazily on the next handshake.
   */
  updateAuth?(auth: SyncAuthPayload | null): void;

  /**
   * Current connection status.
   */
  readonly connected: boolean;

  /**
   * Unique identifier for this transport client.
   * Used to filter self-updates in distributed sync.
   */
  readonly clientId: string;
}

export type SyncTransportConnectOptions = {
  readonly auth?: SyncAuthPayload | null;
};
