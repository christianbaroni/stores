import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createDerivedStore, time, useListen, useStableValue } from '@stores';
import { SyncTheme, useSyncPlaygroundStore, syncPlaygroundActions } from '../stores/syncPlaygroundStore';

const THEME_STYLES: Record<SyncTheme, { accent: string; background: string; bodyBg: string; panel: string }> = {
  'deep-ocean': {
    accent: '#1AA3FF',
    background: 'linear-gradient(135deg, #0B1D3C 0%, #01203A 50%, #023959 100%)',
    bodyBg: '#0B1D3C',
    panel: 'rgba(3, 22, 45, 0.78)',
  },
  'midnight': {
    accent: '#9B6BFF',
    background: 'linear-gradient(135deg, #16102C 0%, #1E1038 50%, #38125D 100%)',
    bodyBg: '#16102C',
    panel: 'rgba(22, 16, 44, 0.78)',
  },
  'sunrise': {
    accent: '#FF7A45',
    background: 'linear-gradient(135deg, #FFEFBA 0%, #FFFFFF 50%, #FFD9A0 100%)',
    bodyBg: '#FFEFBA',
    panel: 'rgba(255, 255, 255, 0.85)',
  },
};

const THEME_OPTIONS: Array<{ description: string; theme: SyncTheme; title: string }> = [
  { description: 'Bright and optimistic for quick planning.', theme: 'sunrise', title: 'Sunrise' },
  { description: 'Cool blues suited for focus sprints.', theme: 'deep-ocean', title: 'Deep Ocean' },
  { description: 'Moody purples for night owl sessions.', theme: 'midnight', title: 'Midnight' },
];

const DISPLAY_NAME_SUGGESTIONS = ['Aurora', 'Cedar', 'Echo', 'Lagoon', 'Moss', 'Orchid', 'Quartz', 'Sierra', 'Violet'];

export function SyncPlayground() {
  const { defaultName, sessionId } = useStableValue(buildConfig);
  const theme = useSyncPlaygroundStore(s => s.theme);
  const themeStyles = THEME_STYLES[theme];

  useListen(
    useSyncPlaygroundStore,
    s => s.theme,
    theme => {
      const backgroundColor = THEME_STYLES[theme].bodyBg;
      document.body.style.backgroundColor = backgroundColor;

      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', backgroundColor);
    },
    { fireImmediately: true }
  );

  useEffect(() => {
    syncPlaygroundActions.initializeSession(sessionId, defaultName);
    const interval = setInterval(() => syncPlaygroundActions.heartbeat(), time.seconds(2));
    return () => {
      clearInterval(interval);
      syncPlaygroundActions.removeParticipant(sessionId);
    };
  }, [defaultName, sessionId]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: themeStyles.background,
        paddingBottom: 'max(72px, env(safe-area-inset-bottom))',
      }}
    >
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 200,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px',
          paddingTop: `max(20px, env(safe-area-inset-top))`,
          backdropFilter: 'blur(18px) saturate(180%)',
          WebkitBackdropFilter: 'blur(18px) saturate(180%)',
          background: 'transparent',
        }}
      >
        <Link
          to="/"
          style={{
            color: theme === 'sunrise' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)',
            fontWeight: 600,
            fontSize: 16,
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
        >
          ‹ Back to films
        </Link>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: theme === 'sunrise' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)',
            textTransform: 'uppercase',
          }}
        >
          Sync Playground
        </div>
      </nav>

      <main
        style={{
          margin: '0 auto',
          maxWidth: 1080,
          padding: '32px clamp(16px, 4vw, 48px)',
          display: 'grid',
          gap: 32,
        }}
      >
        <section
          style={{
            borderRadius: 28,
            padding: '32px clamp(20px, 4vw, 48px)',
            background: themeStyles.panel,
            color: theme === 'sunrise' ? '#212121' : 'rgba(255, 255, 255, 0.92)',
            boxShadow: '0 35px 80px rgba(0, 0, 0, 0.18)',
            display: 'grid',
            gap: 28,
          }}
        >
          <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span
              style={{
                fontSize: 14,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: theme === 'sunrise' ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.6)',
              }}
            >
              Collaborative workspace
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(32px, 5vw, 48px)',
                letterSpacing: '-0.03em',
                fontWeight: 800,
              }}
            >
              Sync across tabs instantly
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 17,
                lineHeight: 1.6,
                color: theme === 'sunrise' ? 'rgba(34, 34, 34, 0.72)' : 'rgba(255, 255, 255, 0.7)',
              }}
            >
              Open this page in a second tab or browser window. Every edit updates the shared state via the sync engine, regardless of which
              tab makes the change.
            </p>
          </header>

          <div
            style={{
              display: 'grid',
              gap: 24,
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'grid', gap: 16 }}>
              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Your tab label</span>
                <DisplayNameInput theme={theme} />
              </label>
              <PresenceIndicator theme={theme} themeAccent={themeStyles.accent} />
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Shared title</span>
              <SharedTitleInput theme={theme} />
              <SharedNotesTextarea theme={theme} />
            </div>
          </div>

          <footer
            style={{
              display: 'grid',
              gap: 24,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <div style={{ display: 'grid', gap: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Theme</span>
              <div style={{ display: 'grid', gap: 12 }}>
                {THEME_OPTIONS.map(option => {
                  const isActive = option.theme === theme;
                  return (
                    <button
                      key={option.theme}
                      type="button"
                      onClick={() => syncPlaygroundActions.chooseTheme(option.theme)}
                      style={{
                        display: 'grid',
                        gap: 6,
                        padding: '14px 16px',
                        textAlign: 'left',
                        borderRadius: 14,
                        background: isActive
                          ? `${themeStyles.accent}20`
                          : theme === 'sunrise'
                            ? 'rgba(255, 255, 255, 0.85)'
                            : 'rgba(6, 6, 20, 0.6)',
                        border: isActive ? `2px solid ${themeStyles.accent}` : '1px solid rgba(255, 255, 255, 0.1)',
                        color: theme === 'sunrise' ? '#1c1c1c' : 'rgba(255, 255, 255, 0.88)',
                        cursor: 'pointer',
                        font: 'inherit',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{option.title}</span>
                      <span style={{ fontSize: 13, opacity: 0.7 }}>{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Participants</span>
              <ParticipantsList sessionId={sessionId} theme={theme} themeAccent={themeStyles.accent} />
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Last edit</span>
              <LastEditInfo theme={theme} />
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}

function RelativeTime({ timestamp, prefix = '' }: { prefix?: string; timestamp: number }) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <>
      {prefix}
      {formatRelativeTime(timestamp)}
    </>
  );
}

const useParticipantEntries = createDerivedStore($ => Object.entries($(useSyncPlaygroundStore).participants));

function DisplayNameInput({ theme }: { theme: SyncTheme }) {
  const displayName = useSyncPlaygroundStore(s => s.localDisplayName);
  return (
    <input
      value={displayName}
      onChange={event => syncPlaygroundActions.setLocalDisplayName(event.target.value)}
      style={{
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.2)',
        padding: '12px 16px',
        fontSize: 16,
        background: theme === 'sunrise' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 15, 24, 0.7)',
        color: theme === 'sunrise' ? '#1f1f1f' : 'rgba(255, 255, 255, 0.92)',
        outline: 'none',
      }}
    />
  );
}

function SharedTitleInput({ theme }: { theme: SyncTheme }) {
  const sharedTitle = useSyncPlaygroundStore(s => s.sharedTitle);
  return (
    <input
      value={sharedTitle}
      onChange={event => syncPlaygroundActions.updateSharedTitle(event.target.value)}
      style={{
        borderRadius: 16,
        border: 'none',
        padding: '18px 20px',
        fontSize: 22,
        fontWeight: 700,
        background: theme === 'sunrise' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(6, 6, 18, 0.55)',
        color: theme === 'sunrise' ? '#171717' : 'rgba(255, 255, 255, 0.92)',
        outline: 'none',
      }}
    />
  );
}

function SharedNotesTextarea({ theme }: { theme: SyncTheme }) {
  const sharedNotes = useSyncPlaygroundStore(s => s.sharedNotes);
  return (
    <textarea
      value={sharedNotes}
      onChange={event => syncPlaygroundActions.updateSharedNotes(event.target.value)}
      placeholder="Add shared notes, bullet lists, or TODOs…"
      rows={8}
      style={{
        borderRadius: 16,
        border: 'none',
        padding: '18px 20px',
        fontSize: 16,
        lineHeight: 1.6,
        background: theme === 'sunrise' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(5, 5, 15, 0.62)',
        color: theme === 'sunrise' ? '#1d1d1d' : 'rgba(255, 255, 255, 0.88)',
        outline: 'none',
        resize: 'vertical',
        minHeight: 180,
      }}
    />
  );
}

function PresenceIndicator({ theme, themeAccent }: { theme: SyncTheme; themeAccent: string }) {
  const participantCount = useSyncPlaygroundStore(s => Object.keys(s.participants).length);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 12,
        border: `1px solid ${themeAccent}40`,
        background: theme === 'sunrise' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(8, 8, 18, 0.6)',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          background: themeAccent,
          boxShadow: `0 0 12px ${themeAccent}`,
        }}
      />
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Presence</span>
        <span style={{ fontSize: 13, opacity: 0.7 }}>
          {participantCount === 0
            ? 'Only you are here right now.'
            : `${participantCount} participant${participantCount > 1 ? 's' : ''} connected.`}
        </span>
      </div>
    </div>
  );
}

function ParticipantsList({ sessionId, theme, themeAccent }: { sessionId: string; theme: SyncTheme; themeAccent: string }) {
  const participantEntries = useParticipantEntries();
  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        borderRadius: 14,
        padding: 16,
        background: theme === 'sunrise' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(8, 8, 18, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        minHeight: 112,
      }}
    >
      {participantEntries.length === 0 ? (
        <span style={{ fontSize: 14, opacity: 0.7 }}>Waiting for another tab to connect…</span>
      ) : (
        participantEntries.map(([id, info]) => {
          const isSelf = id === sessionId;
          return (
            <div
              key={id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 12,
                background: isSelf ? `${themeAccent}26` : 'rgba(255, 255, 255, 0.05)',
              }}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {info.label}
                  {isSelf ? ' (you)' : ''}
                </span>
                <span style={{ fontSize: 12, opacity: 0.65 }}>
                  <RelativeTime timestamp={info.lastSeenAt} prefix="Last seen " />
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function LastEditInfo({ theme }: { theme: SyncTheme }) {
  const lastEditedBy = useSyncPlaygroundStore(s => s.lastEditedBy);
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        borderRadius: 14,
        padding: 16,
        background: theme === 'sunrise' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(10, 10, 24, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        minHeight: 112,
      }}
    >
      {lastEditedBy ? (
        <>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{lastEditedBy.label}</span>
          <span style={{ fontSize: 13, opacity: 0.7 }}>
            <RelativeTime timestamp={lastEditedBy.at} prefix="Updated " />
          </span>
          <code
            style={{
              marginTop: 12,
              fontSize: 12,
              padding: '8px 10px',
              borderRadius: 10,
              background: theme === 'sunrise' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.4)',
              color: theme === 'sunrise' ? '#1c1c1c' : 'rgba(255, 255, 255, 0.8)',
            }}
          >
            session: {lastEditedBy.sessionId}
          </code>
        </>
      ) : (
        <span style={{ fontSize: 14, opacity: 0.7 }}>No edits yet. Start typing to populate the workspace.</span>
      )}
    </div>
  );
}

function buildConfig(): { defaultName: string; sessionId: string } {
  return {
    defaultName: pickDefaultName(),
    sessionId: createSessionId(),
  };
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickDefaultName(): string {
  const index = Math.floor(Math.random() * DISPLAY_NAME_SUGGESTIONS.length);
  return `${DISPLAY_NAME_SUGGESTIONS[index]} tab`;
}

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 5) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}
