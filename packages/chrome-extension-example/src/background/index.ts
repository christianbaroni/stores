import { addTimelineEntry, heartbeat, removeCrew, updateSystemPulse } from '../shared/missionControlStore';
import { PulseStatus } from '../shared/missionControlStore';
import { createIdentity } from '../shared/identity';

const identity = createIdentity('Service Worker');

// Track active connections by sessionId
const activeConnections = new Map<string, chrome.runtime.Port>();

heartbeat(identity);
addTimelineEntry('Background service worker synchronized with mission control.', 'info', identity);

const STATUS_CYCLE: PulseStatus[] = ['nominal', 'nominal', 'elevated', 'nominal'];
let cycleIndex = 0;

function schedulePulse(): void {
  heartbeat(identity);
  const status = STATUS_CYCLE[cycleIndex % STATUS_CYCLE.length];
  updateSystemPulse(status, identity);
  if (status !== 'nominal') {
    addTimelineEntry('Background diagnostics spotted something worth a quick look.', 'warning', identity);
  }
  cycleIndex += 1;
  // Heartbeat every 2 seconds to match popup interval and stay within 8s TTL
  setTimeout(schedulePulse, 2000);
}

schedulePulse();

if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Clear ephemeral crew state on extension startup
  // Crew and crewRemovals should not persist across extension restarts
  chrome.runtime.onStartup.addListener(async () => {
    const storageKey = 'extension:missionControlStore23432112';
    try {
      const stored = await chrome.storage.local.get(storageKey);
      if (stored[storageKey]) {
        const state = JSON.parse(stored[storageKey]);
        state.crew = {};
        state.crewRemovals = {};
        await chrome.storage.local.set({ [storageKey]: JSON.stringify(state) });
      }
    } catch (error) {
      console.error('[Background] Failed to clear crew on startup:', error);
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    addTimelineEntry('Extension installed · all contexts wired for sync.', 'success', identity);
  });

  // Listen for connections from popup/options
  chrome.runtime.onConnect.addListener(port => {
    // Extract sessionId directly from port name (format: "popup-{sessionId}" or "options-{sessionId}")
    const match = port.name.match(/^(?:popup|options)-(.+)$/);
    if (!match) return;

    const sessionId = match[1];
    activeConnections.set(sessionId, port);

    port.onDisconnect.addListener(() => {
      removeCrew(sessionId);
      activeConnections.delete(sessionId);
    });
  });
}
