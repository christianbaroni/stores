import { createBaseStore, time } from '@stores';
import { ChromeExtensionSyncEngine } from './chromeExtensionSyncEngine';
import { ChromeStorageAdapter } from './chromeStorageAdapter';

export type MissionTheme = 'solstice' | 'midnight' | 'aurora';
export type PulseStatus = 'nominal' | 'elevated' | 'critical';
export type TimelineTone = 'info' | 'success' | 'warning';

export type ExtensionIdentity = {
  color: string;
  label: string;
  sessionId: string;
};

export type CrewMember = {
  color: string;
  label: string;
  lastSeenAt: number;
};

export type MissionTask = {
  completed: boolean;
  id: string;
  title: string;
  updatedAt: number;
  updatedBy: string;
};

export type TimelineEntry = {
  authorColor: string;
  authorLabel: string;
  createdAt: number;
  id: string;
  message: string;
  tone: TimelineTone;
};

export type MissionControlState = {
  crew: Record<string, CrewMember>;
  crewRemovals: Record<string, number>; // sessionId -> removal timestamp
  missionName: string;
  missionSummary: string;
  systemPulse: {
    lastPingAt: number;
    reportedBy: string;
    status: PulseStatus;
  };
  tasks: MissionTask[];
  theme: MissionTheme;
  timeline: TimelineEntry[];
  acknowledgeMission: (name: string, summary: string, identity: ExtensionIdentity) => void;
  addTask: (title: string, identity: ExtensionIdentity) => void;
  addTimelineEntry: (message: string, tone: TimelineTone, identity: ExtensionIdentity) => void;
  heartbeat: (identity: ExtensionIdentity) => void;
  pruneExpiredCrew: () => void;
  removeCrew: (sessionId: string) => void;
  setTheme: (theme: MissionTheme, identity: ExtensionIdentity) => void;
  toggleTask: (taskId: string, identity: ExtensionIdentity) => void;
  updateSystemPulse: (status: PulseStatus, identity: ExtensionIdentity) => void;
};

export function getString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  return value.trim();
}

export function getTimelineTone(value: FormDataEntryValue | null): TimelineTone {
  switch (value) {
    case 'info':
    case 'success':
    case 'warning':
      return value;
    default:
      return 'info';
  }
}

const MAX_TIMELINE_ITEMS = 12;
const PRESENCE_TTL_MS = time.seconds(8);
const STORAGE_NAMESPACE = '@stores/chrome-extension';

const storage = new ChromeStorageAdapter({ namespace: STORAGE_NAMESPACE });
const syncEngine = new ChromeExtensionSyncEngine({ storage });

export const useMissionControlStore = createBaseStore<MissionControlState>(
  set => ({
    crew: {},
    crewRemovals: {},
    missionName: 'Aurora Expedition',
    missionSummary:
      'Coordinate a synchronized research effort that spans your popup, options page, and background service worker. Every context feeds the same control board.',
    systemPulse: {
      lastPingAt: now(),
      reportedBy: 'System',
      status: 'nominal',
    },
    tasks: [
      {
        completed: false,
        id: generateId('task'),
        title: 'Review overnight telemetry',
        updatedAt: now(),
        updatedBy: 'System',
      },
      {
        completed: false,
        id: generateId('task'),
        title: 'Align crew priorities across contexts',
        updatedAt: now(),
        updatedBy: 'System',
      },
    ],
    theme: 'solstice',
    timeline: [
      {
        authorColor: '#6366F1',
        authorLabel: 'System',
        createdAt: now(),
        id: generateId('event'),
        message: 'Mission console initialized — open the popup and options page to explore live sync.',
        tone: 'info',
      },
    ],

    acknowledgeMission: (name, summary, identity) =>
      set(state => {
        const nextName = coerceNonEmpty(name, state.missionName, 80);
        const nextSummary = coerceNonEmpty(summary, state.missionSummary, 220);
        const timestamp = now();
        const message = `${describeActor(identity)} re-centered the mission focus.`;
        return {
          crew: recordHeartbeat(state.crew, identity, timestamp),
          missionName: nextName,
          missionSummary: nextSummary,
          timeline: limitTimeline([
            ...state.timeline,
            {
              authorColor: identity.color,
              authorLabel: identity.label,
              createdAt: timestamp,
              id: generateId('event'),
              message,
              tone: 'success',
            },
          ]),
        };
      }),

    addTask: (title, identity) =>
      set(state => {
        const trimmed = coerceNonEmpty(title, '', 80);
        if (!trimmed) return state;
        const timestamp = now();
        const nextTask: MissionTask = {
          completed: false,
          id: generateId('task'),
          title: trimmed,
          updatedAt: timestamp,
          updatedBy: describeActor(identity),
        };
        return {
          crew: recordHeartbeat(state.crew, identity, timestamp),
          tasks: [nextTask, ...state.tasks],
          timeline: limitTimeline([
            ...state.timeline,
            {
              authorColor: identity.color,
              authorLabel: identity.label,
              createdAt: timestamp,
              id: generateId('event'),
              message: `${describeActor(identity)} added "${trimmed}".`,
              tone: 'info',
            },
          ]),
        };
      }),

    addTimelineEntry: (message, tone, identity) =>
      set(state => {
        const trimmed = coerceNonEmpty(message, '', 200);
        if (!trimmed) return state;
        const timestamp = now();
        return {
          crew: recordHeartbeat(state.crew, identity, timestamp),
          timeline: limitTimeline([
            ...state.timeline,
            {
              authorColor: identity.color,
              authorLabel: identity.label,
              createdAt: timestamp,
              id: generateId('event'),
              message: trimmed,
              tone,
            },
          ]),
        };
      }),

    heartbeat: identity =>
      set(state => {
        const timestamp = now();
        const nextCrew = recordHeartbeat(state.crew, identity, timestamp);
        if (nextCrew === state.crew) return state;

        // Clear any removal tombstone for this session since it's back online
        const { [identity.sessionId]: _removed, ...remainingRemovals } = state.crewRemovals;

        // Always return both crew and crewRemovals to ensure they sync together
        return {
          crew: nextCrew,
          crewRemovals: remainingRemovals,
        };
      }),

    pruneExpiredCrew: () =>
      set(state => {
        const timestamp = now();
        const pruned = pruneCrew(state.crew, timestamp);
        if (pruned === state.crew) return state;
        return { crew: pruned };
      }),

    removeCrew: (sessionId: string) =>
      set(state => {
        const timestamp = now();
        const { [sessionId]: removed, ...remainingCrew } = state.crew;
        if (!removed) return state; // No change if sessionId doesn't exist

        // Record removal with timestamp to prevent resurrection by concurrent heartbeats
        return {
          crew: remainingCrew,
          crewRemovals: {
            ...state.crewRemovals,
            [sessionId]: timestamp,
          },
        };
      }),

    setTheme: (theme, identity) =>
      set(state => {
        if (state.theme === theme) {
          return { crew: recordHeartbeat(state.crew, identity, now()) };
        }
        const timestamp = now();
        return {
          crew: recordHeartbeat(state.crew, identity, timestamp),
          theme,
          timeline: limitTimeline([
            ...state.timeline,
            {
              authorColor: identity.color,
              authorLabel: identity.label,
              createdAt: timestamp,
              id: generateId('event'),
              message: `${describeActor(identity)} set the console to the ${theme} theme.`,
              tone: 'info',
            },
          ]),
        };
      }),

    toggleTask: (taskId, identity) =>
      set(state => {
        let toggled = false;
        const timestamp = now();
        const nextTasks = state.tasks.map(task => {
          if (task.id !== taskId) return task;
          toggled = true;
          return {
            ...task,
            completed: !task.completed,
            updatedAt: timestamp,
            updatedBy: describeActor(identity),
          };
        });
        if (!toggled) return state;
        const toggledTask = nextTasks.find(task => task.id === taskId);
        const tone: TimelineTone = toggledTask?.completed ? 'success' : 'warning';
        const message = toggledTask?.completed
          ? `${describeActor(identity)} cleared "${toggledTask.title}".`
          : `${describeActor(identity)} reopened "${toggledTask?.title ?? 'a task'}".`;
        return {
          crew: recordHeartbeat(state.crew, identity, timestamp),
          tasks: nextTasks,
          timeline: limitTimeline([
            ...state.timeline,
            {
              authorColor: identity.color,
              authorLabel: identity.label,
              createdAt: timestamp,
              id: generateId('event'),
              message,
              tone,
            },
          ]),
        };
      }),

    updateSystemPulse: (status, identity) =>
      set(state => {
        const timestamp = now();
        return {
          crew: recordHeartbeat(state.crew, identity, timestamp),
          systemPulse: {
            lastPingAt: timestamp,
            reportedBy: describeActor(identity),
            status,
          },
          timeline: limitTimeline([
            ...state.timeline,
            {
              authorColor: identity.color,
              authorLabel: identity.label,
              createdAt: timestamp,
              id: generateId('event'),
              message: `${describeActor(identity)} flagged system status as ${status}.`,
              tone: status === 'critical' ? 'warning' : 'info',
            },
          ]),
        };
      }),
  }),
  {
    storage,
    storageKey: 'extension:missionControlStore',
    sync: { engine: syncEngine },
  }
);

export const { acknowledgeMission, addTask, addTimelineEntry, heartbeat, removeCrew, setTheme, toggleTask, updateSystemPulse } =
  useMissionControlStore.getState();

function now(): number {
  return Date.now();
}

function coerceNonEmpty(value: string, fallback: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed.length) return fallback;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function pruneCrew(members: Record<string, CrewMember>, currentTime: number): Record<string, CrewMember> {
  let didPrune = false;
  const next: Record<string, CrewMember> = {};
  for (const [sessionId, info] of Object.entries(members)) {
    if (currentTime - info.lastSeenAt <= PRESENCE_TTL_MS) {
      next[sessionId] = info;
    } else {
      didPrune = true;
    }
  }
  return didPrune ? next : members;
}

function recordHeartbeat(
  members: Record<string, CrewMember>,
  identity: ExtensionIdentity,
  currentTime: number
): Record<string, CrewMember> {
  const existing = members[identity.sessionId];

  // No change needed if member exists with same identity and recent timestamp
  if (existing && existing.color === identity.color && existing.label === identity.label && currentTime - existing.lastSeenAt < 500) {
    return members;
  }

  // Add or update this member only
  return {
    ...members,
    [identity.sessionId]: {
      color: identity.color,
      label: identity.label,
      lastSeenAt: currentTime,
    },
  };
}

function limitTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  if (entries.length <= MAX_TIMELINE_ITEMS) return entries;
  return entries.slice(entries.length - MAX_TIMELINE_ITEMS);
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function describeActor(identity: ExtensionIdentity): string {
  return identity.label;
}
