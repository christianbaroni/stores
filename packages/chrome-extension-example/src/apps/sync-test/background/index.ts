import { time } from 'stores';
import { syncTestActions, useSyncTestStore } from '../shared/syncTestStore';
import { createContext } from '../shared/identity';

const context = createContext('background', 'Background');

// Initialize background context heartbeat
syncTestActions.heartbeat(context);

// Track active connections by sessionId
const activeConnections = new Map<string, chrome.runtime.Port>();

function schedulePulse(): void {
  syncTestActions.heartbeat(context);
  // Heartbeat every 2 seconds to match popup/options interval and stay within 3s TTL
  setTimeout(schedulePulse, time.seconds(2));
}

schedulePulse();

if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Clear ephemeral context state on extension startup
  chrome.runtime.onStartup.addListener(async () => {
    const storageKey = 'extension:syncTest';
    try {
      const stored = await chrome.storage.local.get(storageKey);
      if (stored[storageKey]) {
        const state = JSON.parse(stored[storageKey]);
        state.activeContexts = {};
        await chrome.storage.local.set({ [storageKey]: JSON.stringify(state) });
      }
    } catch (error) {
      console.error('[Background] Failed to clear contexts on startup:', error);
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    console.log('[Background] Extension installed - sync engine initialized');
  });

  // Listen for connections from popup/options
  chrome.runtime.onConnect.addListener(port => {
    const match = port.name.match(/^(popup|options|background)-(.+)$/);
    if (!match) return;

    const sessionId = match[2];
    activeConnections.set(sessionId, port);

    port.onDisconnect.addListener(() => {
      // When a context disconnects, remove it from active contexts
      useSyncTestStore.setState(state => {
        // Only update if the sessionId actually exists in activeContexts
        if (!state.activeContexts[sessionId]) {
          return state;
        }
        const { [sessionId]: _removed, ...remainingContexts } = state.activeContexts;
        return { activeContexts: remainingContexts };
      });
      activeConnections.delete(sessionId);
    });
  });
}
