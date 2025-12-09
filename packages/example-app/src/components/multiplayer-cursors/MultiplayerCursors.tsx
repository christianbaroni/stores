import { JSX, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { time, useStableValue } from 'stores';
import { multiplayerCursorActions, useMultiplayerCursorStore } from '../../stores/multiplayerCursorStore';
import { useActiveCursorsStore } from '../../stores/activeCursorsStore';
import { useClickEffectRenderer } from './useClickEffectRenderer';
import { useCursorRenderer } from './useCursorRenderer';
import { throttle } from './throttle';
import { usePageBackground } from '../../utils/usePageBackground';

// ============ Types ========================================================== //

type SessionConfig = {
  color: string;
  displayName: string;
  sessionId: string;
};

// ============ Constants ====================================================== //

const CURSOR_UPDATE_THROTTLE_MS = 16;
const DISPLAY_NAME_SUGGESTIONS = Object.freeze([
  'Catalyst',
  'Echo',
  'Flux',
  'Nebula',
  'Nova',
  'Orbit',
  'Phoenix',
  'Prism',
  'Quantum',
  'Zenith',
]);

// ============ Component ====================================================== //

export function MultiplayerCursors(): JSX.Element {
  const { color, displayName, sessionId } = useStableValue(buildSessionConfig);
  const pageRef = useRef<HTMLDivElement>(null);

  usePageBackground('#0a0a0a');
  useCursorRenderer(pageRef);
  useClickEffectRenderer(pageRef);

  useEffect(() => {
    multiplayerCursorActions.initializeSession(sessionId, displayName, color);
    return () => {
      multiplayerCursorActions.removeSession(sessionId);
    };
  }, [color, displayName, sessionId]);

  useEffect(() => {
    const interval = setInterval(multiplayerCursorActions.pruneStaleCursors, time.seconds(5));
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const handleMouseMove = throttle((event: MouseEvent) => {
      const rect = page.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      multiplayerCursorActions.updateCursor(x, y);
    }, CURSOR_UPDATE_THROTTLE_MS);

    const handleClick = (event: MouseEvent) => {
      const rect = page.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      multiplayerCursorActions.addClickEffect(x, y);
    };

    page.addEventListener('mousemove', handleMouseMove, { passive: true });
    page.addEventListener('click', handleClick, { capture: true });

    return () => {
      page.removeEventListener('mousemove', handleMouseMove);
      page.removeEventListener('click', handleClick, { capture: true });
    };
  }, []);

  return (
    <div
      ref={pageRef}
      style={{
        background: 'linear-gradient(to bottom, #0a0a0a 0%, #1a1a1a 100%)',
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <nav
        style={{
          backdropFilter: 'blur(24px) saturate(180%)',
          background: 'rgba(10, 10, 10, 0.72)',
          borderBottom: '0.5px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 32px',
          paddingTop: `max(16px, env(safe-area-inset-top))`,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Link
          to="/"
          style={{
            color: 'rgba(255, 255, 255, 0.7)',
            fontWeight: 500,
            fontSize: 15,
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
        >
          ← Ghibli Explorer
        </Link>
        <div
          style={{
            color: 'rgba(255, 255, 255, 0.9)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          Multiplayer Cursors
        </div>
      </nav>

      <main
        style={{
          padding: '64px 32px 32px',
          position: 'relative',
        }}
      >
        <div
          style={{
            margin: '0 auto',
            maxWidth: 1400,
            display: 'grid',
            gap: 48,
          }}
        >
          <header
            style={{
              textAlign: 'center',
              color: '#fff',
              display: 'grid',
              gap: 20,
            }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(48px, 7vw, 72px)',
                fontWeight: 700,
                letterSpacing: '-0.04em',
                background: 'linear-gradient(135deg, #ffffff 0%, #a0a0a0 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Real-Time Cursors
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 17,
                lineHeight: 1.6,
                color: 'rgba(255, 255, 255, 0.6)',
                maxWidth: 600,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              Move your cursor anywhere on this page. Open in multiple tabs to see instant synchronization with smooth animations.
            </p>
          </header>

          <div
            style={{
              display: 'grid',
              gap: 20,
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            }}
          >
            <GlassCard>
              <CardHeader>Your Session</CardHeader>
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: color,
                      boxShadow: `0 0 20px ${color}80, inset 0 1px 1px rgba(255, 255, 255, 0.3)`,
                    }}
                  />
                  <span style={{ fontSize: 20, fontWeight: 600, color: '#fff' }}>
                    <LocalDisplayName />
                  </span>
                </div>
                <code
                  style={{
                    fontSize: 11,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: 'rgba(255, 255, 255, 0.5)',
                    wordBreak: 'break-all',
                    fontFamily: 'SF Mono, Monaco, monospace',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {sessionId}
                </code>
              </div>
            </GlassCard>

            <GlassCard>
              <CardHeader>Active Participants</CardHeader>
              <ActiveCursorCount />
            </GlassCard>

            <GlassCard>
              <CardHeader>Performance</CardHeader>
              <div style={{ display: 'grid', gap: 12, fontSize: 14, lineHeight: 1.7, color: 'rgba(255, 255, 255, 0.7)' }}>
                <div>
                  <strong style={{ color: '#fff' }}>Zero React re-renders</strong> for cursor updates
                </div>
                <div>Direct DOM updates via useListen</div>
                <div>Cross-tab sync via BroadcastChannel</div>
              </div>
            </GlassCard>
          </div>

          <div
            style={{
              height: 20,
            }}
          />
        </div>
      </main>

      <div
        style={{
          position: 'fixed',
          bottom: 32,
          left: 32,
          right: 32,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <div
          style={{
            backdropFilter: 'blur(24px) saturate(180%)',
            background: 'rgba(20, 20, 20, 0.8)',
            border: '0.5px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 16,
            padding: '12px 24px',
            fontSize: 13,
            color: 'rgba(255, 255, 255, 0.7)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          Move your cursor • Click to create effects • Open in multiple tabs
        </div>
      </div>
    </div>
  );
}

function ActiveCursorCount(): JSX.Element {
  const activeCursorCount = useActiveCursorsStore(s => s.length);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          lineHeight: 1,
        }}
      >
        {activeCursorCount}
      </div>
      <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }}>
        {activeCursorCount === 0 ? 'Open in another tab' : `other cursor${activeCursorCount === 1 ? '' : 's'} active`}
      </div>
    </div>
  );
}

function LocalDisplayName(): JSX.Element {
  return <>{useMultiplayerCursorStore(s => s.localDisplayName)}</>;
}

// ============ Base Components ================================================ //

function GlassCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        backdropFilter: 'blur(24px) saturate(180%)',
        background: 'rgba(30, 30, 30, 0.6)',
        border: '0.5px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 20,
        padding: '28px 32px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h3
      style={{
        margin: '0 0 20px 0',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'rgba(255, 255, 255, 0.5)',
      }}
    >
      {children}
    </h3>
  );
}

// ============ Utilities ====================================================== //

function buildSessionConfig(): SessionConfig {
  return {
    color: pickRandomColor(),
    displayName: pickRandomDisplayName(),
    sessionId: createSessionId(),
  };
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickRandomDisplayName(): string {
  const index = Math.floor(Math.random() * DISPLAY_NAME_SUGGESTIONS.length);
  return DISPLAY_NAME_SUGGESTIONS[index];
}

function pickRandomColor(): string {
  return multiplayerCursorActions.assignCursorColor(createSessionId());
}
