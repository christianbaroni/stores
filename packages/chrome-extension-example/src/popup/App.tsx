import { memo, useEffect } from 'react';
import { time } from '@stores';
import { useSortedCrew, useTimelinePreview, useThemeTokens } from '../shared/derivedStores';
import {
  ExtensionIdentity,
  MissionTheme,
  PulseStatus,
  addTask,
  addTimelineEntry,
  acknowledgeMission,
  getString,
  heartbeat,
  setTheme,
  toggleTask,
  updateSystemPulse,
  useMissionControlStore,
} from '../shared/missionControlStore';
import './styles.css';

type AppProps = {
  identity: ExtensionIdentity;
};

const THEMES: MissionTheme[] = ['solstice', 'midnight', 'aurora'];
const STATUSES: PulseStatus[] = ['nominal', 'elevated', 'critical'];

const PopupHeader = memo(function PopupHeader() {
  const missionName = useMissionControlStore(state => state.missionName);
  const missionSummary = useMissionControlStore(state => state.missionSummary);
  const systemPulse = useMissionControlStore(state => state.systemPulse);
  const themeTokens = useThemeTokens();

  return (
    <header className="popup-header">
      <div>
        <h1>{missionName}</h1>
        <p className="summary" style={{ color: themeTokens.muted }}>
          {missionSummary}
        </p>
      </div>
      <div className="pulse" data-status={systemPulse.status}>
        <span className="pulse-dot" />
        <div>
          <strong>{systemPulse.status.toUpperCase()}</strong>
          <small>last ping {formatRelativeTime(systemPulse.lastPingAt)}</small>
        </div>
      </div>
    </header>
  );
});

const PresencePanel = memo(function PresencePanel() {
  const crew = useSortedCrew();

  return (
    <section className="panel">
      <h2>Presence</h2>
      <div className="presence-row">
        {crew.map(info => (
          <span key={`${info.label}-${info.lastSeenAt}`} className="presence-chip" style={{ backgroundColor: info.color }}>
            {info.label}
          </span>
        ))}
      </div>
    </section>
  );
});

const MissionForm = memo(function MissionForm({ identity }: { identity: ExtensionIdentity }) {
  const missionName = useMissionControlStore(state => state.missionName);
  const missionSummary = useMissionControlStore(state => state.missionSummary);
  const themeTokens = useThemeTokens();

  return (
    <section className="panel">
      <h2>Focus the mission</h2>
      <form
        className="mission-form"
        onSubmit={event => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const name = getString(formData.get('missionName'));
          const summary = getString(formData.get('missionSummary'));
          if (!name || !summary) return;
          acknowledgeMission(name, summary, identity);
        }}
      >
        <label>
          Mission name
          <input key={missionName} name="missionName" defaultValue={missionName} />
        </label>
        <label>
          Mission summary
          <textarea key={missionSummary} name="missionSummary" defaultValue={missionSummary} rows={3} />
        </label>
        <button type="submit" style={{ backgroundColor: themeTokens.accent }}>
          Save alignment
        </button>
      </form>
    </section>
  );
});

const ThemeSelector = memo(function ThemeSelector({ identity }: { identity: ExtensionIdentity }) {
  const theme = useMissionControlStore(state => state.theme);
  const themeTokens = useThemeTokens();

  return (
    <section className="panel">
      <h2>Console theme</h2>
      <div className="theme-grid">
        {THEMES.map(option => (
          <button
            key={option}
            className={option === theme ? 'theme-button active' : 'theme-button'}
            onClick={() => setTheme(option, identity)}
            style={{ borderColor: option === theme ? themeTokens.accent : 'transparent' }}
            type="button"
          >
            <span className="swatch" data-theme={option} />
            {option}
          </button>
        ))}
      </div>
    </section>
  );
});

const SharedChecklist = memo(function SharedChecklist({ identity }: { identity: ExtensionIdentity }) {
  const tasks = useMissionControlStore(state => state.tasks);
  const themeTokens = useThemeTokens();

  return (
    <section className="panel">
      <h2>Shared checklist</h2>
      <form
        className="task-form"
        onSubmit={event => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const title = getString(formData.get('taskTitle'));
          if (!title) return;
          addTask(title, identity);
          event.currentTarget.reset();
        }}
      >
        <input name="taskTitle" placeholder="Add a task" />
        <button type="submit" style={{ backgroundColor: themeTokens.accent }}>
          Add
        </button>
      </form>
      <ul className="task-list">
        {tasks.map(task => (
          <li key={task.id}>
            <label className={task.completed ? 'task completed' : 'task'}>
              <input checked={task.completed} onChange={() => toggleTask(task.id, identity)} type="checkbox" />
              <span>
                <strong>{task.title}</strong>
                <small>
                  {task.completed ? 'Completed' : 'Updated'} {formatRelativeTime(task.updatedAt)} by {task.updatedBy}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
});

const BroadcastPanel = memo(function BroadcastPanel({ identity }: { identity: ExtensionIdentity }) {
  const themeTokens = useThemeTokens();

  return (
    <section className="panel">
      <h2>Broadcast update</h2>
      <form
        className="broadcast"
        onSubmit={event => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const message = getString(formData.get('broadcastMessage'));
          if (!message) return;
          addTimelineEntry(message, 'info', identity);
          event.currentTarget.reset();
        }}
      >
        <textarea name="broadcastMessage" placeholder="Share what you changed or what needs attention" rows={2} />
        <div className="broadcast-actions">
          <div className="status-buttons">
            {STATUSES.map(status => (
              <button key={status} type="button" onClick={() => updateSystemPulse(status, identity)}>
                {status}
              </button>
            ))}
          </div>
          <button className="broadcast-submit" style={{ backgroundColor: themeTokens.accent }} type="submit">
            Send update
          </button>
        </div>
      </form>
    </section>
  );
});

const RecentActivity = memo(function RecentActivity() {
  const timeline = useTimelinePreview();

  return (
    <section className="panel">
      <h2>Recent activity</h2>
      <ul className="timeline">
        {timeline.map(entry => (
          <li key={entry.id} className={entry.tone}>
            <span className="indicator" style={{ backgroundColor: entry.authorColor }} />
            <div>
              <div className="timeline-header">
                <strong>{entry.authorLabel}</strong>
                <span>{formatRelativeTime(entry.createdAt)}</span>
              </div>
              <p>{entry.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
});

export function App({ identity }: AppProps) {
  useHeartbeat(identity);
  const themeTokens = useThemeTokens();

  return (
    <div className="popup-shell" style={{ backgroundImage: themeTokens.background }}>
      <div className="glow" style={{ boxShadow: themeTokens.glow }} />
      <PopupHeader />
      <PresencePanel />
      <MissionForm identity={identity} />
      <ThemeSelector identity={identity} />
      <SharedChecklist identity={identity} />
      <BroadcastPanel identity={identity} />
      <RecentActivity />
    </div>
  );
}

export default App;

/**
 * This is purely to visualize active threads in the example extension.
 * Not needed in production.
 */
function useHeartbeat(identity: ExtensionIdentity): void {
  useEffect(() => {
    // Initial heartbeat
    heartbeat(identity);

    // Create a long-lived connection to the service worker
    // The service worker's onDisconnect will fire when this popup closes
    const port = chrome.runtime?.connect({ name: `popup-${identity.sessionId}` });

    // Regular heartbeat interval
    const interval = setInterval(() => heartbeat(identity), time.seconds(2));

    return () => {
      clearInterval(interval);
      port?.disconnect();
    };
  }, [identity]);
}

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60000) return 'moments ago';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} min ago`;
  return `${Math.floor(delta / 3600000)} hr ago`;
}
