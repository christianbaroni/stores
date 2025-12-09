import { memo } from 'react';
import {
  addTask,
  addTimelineEntry,
  acknowledgeMission,
  setTheme,
  toggleTask,
  updateSystemPulse,
  useMissionControlStore,
  getTimelineTone,
  getString,
} from '../shared/missionControlStore';
import type { ExtensionIdentity, MissionTheme, TimelineTone } from '../shared/missionControlStore';
import { useSortedCrew, useReversedTimeline, useThemeTokens } from '../shared/derivedStores';
import { useHeartbeat } from '../shared/useHeartbeat';
import './styles.css';

type AppProps = {
  identity: ExtensionIdentity;
};

const THEMES: MissionTheme[] = ['solstice', 'midnight', 'aurora'];
const TONES: TimelineTone[] = ['info', 'success', 'warning'];

function formatTimestamp(timestamp: number): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(timestamp);
}

const OptionsHeader = memo(function OptionsHeader() {
  const missionName = useMissionControlStore(state => state.missionName);
  const missionSummary = useMissionControlStore(state => state.missionSummary);
  const systemPulse = useMissionControlStore(state => state.systemPulse);

  return (
    <header className="options-header">
      <div>
        <h1>{missionName}</h1>
        <p>{missionSummary}</p>
      </div>
      <div className="pulse" data-status={systemPulse.status}>
        <span className="pulse-dot" />
        <div>
          <strong>Status · {systemPulse.status.toUpperCase()}</strong>
          <small>reported by {systemPulse.reportedBy}</small>
          <small>{new Date(systemPulse.lastPingAt).toLocaleTimeString()}</small>
        </div>
      </div>
    </header>
  );
});

const MissionAlignmentCard = memo(function MissionAlignmentCard({ identity }: { identity: ExtensionIdentity }) {
  const missionName = useMissionControlStore(state => state.missionName);
  const missionSummary = useMissionControlStore(state => state.missionSummary);
  const themeTokens = useThemeTokens();

  return (
    <section className="card span-2">
      <h2>Mission alignment</h2>
      <form
        className="alignment-form"
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
          Name
          <input key={missionName} name="missionName" defaultValue={missionName} />
        </label>
        <label>
          Summary
          <textarea key={missionSummary} name="missionSummary" rows={4} defaultValue={missionSummary} />
        </label>
        <button style={{ backgroundColor: themeTokens.accent }} type="submit">
          Update mission
        </button>
      </form>
    </section>
  );
});

const ThemeCard = memo(function ThemeCard({ identity }: { identity: ExtensionIdentity }) {
  const theme = useMissionControlStore(state => state.theme);
  const themeTokens = useThemeTokens();

  return (
    <section className="card">
      <h2>Theme</h2>
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

const CrewCard = memo(function CrewCard() {
  const crew = useSortedCrew();

  return (
    <section className="card crew">
      <h2>Crew online</h2>
      <ul>
        {crew.map(member => (
          <li key={`${member.label}-${member.lastSeenAt}`}>
            <span className="dot" style={{ backgroundColor: member.color }} />
            <div>
              <strong>{member.label}</strong>
              <small>Active {formatTimestamp(member.lastSeenAt)}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
});

const ChecklistCard = memo(function ChecklistCard({ identity }: { identity: ExtensionIdentity }) {
  const tasks = useMissionControlStore(state => state.tasks);
  const themeTokens = useThemeTokens();

  return (
    <section className="card span-2">
      <h2>Shared checklist</h2>
      <form
        className="task-form"
        onSubmit={event => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const title = getString(formData.get('taskTitle'));
          if (title) {
            addTask(title, identity);
            event.currentTarget.reset();
          }
        }}
      >
        <input name="taskTitle" placeholder="Add a task" />
        <button style={{ backgroundColor: themeTokens.accent }} type="submit">
          Add task
        </button>
      </form>
      <ul className="task-list">
        {tasks.map(task => (
          <li key={task.id}>
            <label className={task.completed ? 'task completed' : 'task'}>
              <input checked={task.completed} onChange={() => toggleTask(task.id, identity)} type="checkbox" />
              <div>
                <strong>{task.title}</strong>
                <small>
                  {task.completed ? 'Completed' : 'Updated'} by {task.updatedBy} at {formatTimestamp(task.updatedAt)}
                </small>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
});

const BroadcastCard = memo(function BroadcastCard({ identity }: { identity: ExtensionIdentity }) {
  const themeTokens = useThemeTokens();

  return (
    <section className="card span-2">
      <h2>Broadcast insight</h2>
      <form
        className="timeline-form"
        onSubmit={event => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const message = getString(formData.get('timelineMessage'));
          const tone = getTimelineTone(formData.get('timelineTone'));
          if (message && tone) {
            addTimelineEntry(message, tone, identity);
            event.currentTarget.reset();
          }
        }}
      >
        <textarea name="timelineMessage" placeholder="Capture wins, callouts, or requests for help" rows={3} />
        <div className="timeline-actions">
          <div className="tone-toggle">
            {TONES.map(tone => (
              <label key={tone} className="tone">
                <input type="radio" name="timelineTone" value={tone} defaultChecked={tone === 'info'} />
                {tone}
              </label>
            ))}
          </div>
          <div className="status-buttons">
            <button type="button" onClick={() => updateSystemPulse('nominal', identity)}>
              Mark nominal
            </button>
            <button type="button" onClick={() => updateSystemPulse('elevated', identity)}>
              Flag elevated
            </button>
            <button type="button" onClick={() => updateSystemPulse('critical', identity)}>
              Raise alert
            </button>
          </div>
          <button className="submit" style={{ backgroundColor: themeTokens.accent }} type="submit">
            Share update
          </button>
        </div>
      </form>
    </section>
  );
});

const TimelineCard = memo(function TimelineCard() {
  const timeline = useReversedTimeline();

  return (
    <section className="card span-2">
      <h2>Timeline</h2>
      <ul className="timeline">
        {timeline.map(entry => (
          <li key={entry.id} className={entry.tone}>
            <span className="marker" style={{ backgroundColor: entry.authorColor }} />
            <div>
              <div className="timeline-meta">
                <strong>{entry.authorLabel}</strong>
                <span>{formatTimestamp(entry.createdAt)}</span>
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
    <div className="options-shell" style={{ backgroundImage: themeTokens.background }}>
      <div className="glow" style={{ boxShadow: themeTokens.glow }} />
      <OptionsHeader />
      <main className="options-grid">
        <MissionAlignmentCard identity={identity} />
        <ThemeCard identity={identity} />
        <CrewCard />
        <ChecklistCard identity={identity} />
        <BroadcastCard identity={identity} />
        <TimelineCard />
      </main>
    </div>
  );
}

export default App;
