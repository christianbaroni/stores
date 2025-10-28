import { time } from '@stores';
import { useEffect } from 'react';
import { ExtensionIdentity, heartbeat } from './missionControlStore';

/**
 * This is purely to visualize active threads in the example extension.
 * Not needed in production.
 */
export function useHeartbeat(identity: ExtensionIdentity, pause = false): void {
  useEffect(() => {
    // Initial heartbeat
    heartbeat(identity);

    // Create a long-lived connection to the service worker
    // The service worker's onDisconnect will fire when this popup closes
    const port = chrome.runtime?.connect({ name: `popup-${identity.sessionId}` });

    return () => {
      port?.disconnect();
    };
  }, [identity]);

  useEffect(() => {
    if (pause) return;

    // Regular heartbeat interval
    const interval = setInterval(() => heartbeat(identity), time.seconds(2));

    return () => {
      clearInterval(interval);
    };
  }, [identity, pause]);
}
