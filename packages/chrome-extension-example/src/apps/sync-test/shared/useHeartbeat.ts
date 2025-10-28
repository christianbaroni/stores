import { time } from 'stores';
import { useEffect } from 'react';
import type { ExtensionContext } from './syncTestStore';
import { syncTestActions } from './syncTestStore';

/**
 * Sends periodic heartbeats to track active contexts across extension threads.
 */
export function useHeartbeat(context: ExtensionContext, pause = false): void {
  useEffect(() => {
    // Initial heartbeat
    syncTestActions.heartbeat(context);

    // Create a long-lived connection to the service worker
    // The service worker's onDisconnect will fire when this context closes
    const port = chrome.runtime?.connect({ name: `${context.type}-${context.sessionId}` });

    return () => {
      port?.disconnect();
    };
  }, [context]);

  useEffect(() => {
    if (pause) return;

    // Regular heartbeat interval
    const interval = setInterval(() => syncTestActions.heartbeat(context), time.seconds(2));

    return () => {
      clearInterval(interval);
    };
  }, [context, pause]);
}
