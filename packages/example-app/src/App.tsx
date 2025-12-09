import { useLayoutEffect, useRef } from 'react';
import { Route, Routes, Link, useLocation } from 'react-router-dom';
import { useListen } from 'stores';
import { Favorites } from './components/Favorites';
import { FilmDetail } from './components/FilmDetail';
import { FilmList } from './components/FilmList';
import { SyncPlayground } from './components/SyncPlayground';
import { VirtualizedList } from './components/VirtualizedList';
import { MultiplayerCursors } from './components/multiplayer-cursors/MultiplayerCursors';
import { SyncTheme, useSyncPlaygroundStore } from './stores/syncPlaygroundStore';

// ============ Constants ====================================================== //

const SYNC_THEME_COLORS: Record<SyncTheme, { text: string }> = {
  'deep-ocean': { text: 'rgba(255, 255, 255, 0.7)' },
  'midnight': { text: 'rgba(255, 255, 255, 0.7)' },
  'sunrise': { text: 'rgba(0, 0, 0, 0.7)' },
};

// ============ Component ====================================================== //

export function App() {
  const location = useLocation();
  const isFilmRoute = location.pathname === '/' || location.pathname.startsWith('/film') || location.pathname === '/favorites';
  const isRainbowRoute = location.pathname.startsWith('/rainbow');
  const isSyncRoute = location.pathname.startsWith('/sync');
  const isCursorsRoute = location.pathname.startsWith('/cursors');

  const isFirstRender = useRef(true);
  const navRef = useRef<HTMLElement>(null);

  const isFilmRouteRef = useRef(isFilmRoute);
  isFilmRouteRef.current = isFilmRoute;

  useListen(
    useSyncPlaygroundStore,
    s => s.theme,
    theme => {
      if (!navRef.current) return;

      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/sync')) return;

      const textColor = SYNC_THEME_COLORS[theme].text;
      const links = navRef.current.querySelectorAll<HTMLAnchorElement>('a');

      links.forEach(link => {
        link.style.color = textColor;
      });
    },
    { fireImmediately: true }
  );

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (!navRef.current) return;

    if (isSyncRoute) {
      const theme = useSyncPlaygroundStore.getState().theme;
      const textColor = SYNC_THEME_COLORS[theme].text;
      const links = navRef.current.querySelectorAll<HTMLAnchorElement>('a');

      links.forEach(link => {
        link.style.color = textColor;
      });
    } else {
      const links = navRef.current.querySelectorAll<HTMLAnchorElement>('a');
      links.forEach(link => {
        link.style.color = isFilmRouteRef.current ? '#fff' : '#000';
      });
    }
  }, [isSyncRoute]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: isCursorsRoute ? 'transparent' : isSyncRoute ? 'transparent' : isFilmRoute ? '#000' : '#f1f3f7',
      }}
    >
      {!isCursorsRoute && (
        <nav
          ref={navRef}
          style={{
            display: 'flex',
            gap: 32,
            padding: '20px 24px',
            paddingTop: `max(20px, env(safe-area-inset-top))`,
            background: isSyncRoute ? 'transparent' : isFilmRoute ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.95)',
            backdropFilter: isSyncRoute ? 'none' : 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: isSyncRoute ? 'none' : 'saturate(180%) blur(20px)',
            borderBottom: isSyncRoute ? 'none' : isFilmRoute ? '0.5px solid rgba(255, 255, 255, 0.1)' : '0.5px solid rgba(0, 0, 0, 0.1)',
            position: 'sticky',
            top: 0,
            zIndex: 100,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <Link
            to="/"
            style={{
              fontWeight: isFilmRoute ? 700 : 600,
              textDecoration: 'none',
              color: isFilmRoute ? '#fff' : '#000',
              fontSize: 17,
              opacity: isFilmRoute ? 1 : 0.5,
              letterSpacing: '-0.01em',
              transition: 'opacity 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            Ghibli Explorer
          </Link>
          <Link
            to="/rainbow"
            style={{
              fontWeight: isRainbowRoute ? 700 : 600,
              textDecoration: 'none',
              color: isFilmRoute ? 'rgba(255, 255, 255, 0.5)' : '#000',
              fontSize: 17,
              opacity: isRainbowRoute ? 1 : 0.5,
              letterSpacing: '-0.01em',
              transition: 'opacity 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            Virtualized List
          </Link>
          <Link
            to="/sync"
            style={{
              fontWeight: isSyncRoute ? 700 : 600,
              textDecoration: 'none',
              color: isFilmRoute ? 'rgba(255, 255, 255, 0.5)' : '#000',
              fontSize: 17,
              opacity: isSyncRoute ? 1 : 0.5,
              letterSpacing: '-0.01em',
              transition: 'opacity 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            Sync Playground
          </Link>
          <Link
            to="/cursors"
            style={{
              fontWeight: isCursorsRoute ? 700 : 600,
              textDecoration: 'none',
              color: isFilmRoute ? 'rgba(255, 255, 255, 0.5)' : '#000',
              fontSize: 17,
              opacity: isCursorsRoute ? 1 : 0.5,
              letterSpacing: '-0.01em',
              transition: 'opacity 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            Multiplayer Cursors
          </Link>
        </nav>
      )}
      <Routes>
        <Route path="/" element={<FilmList />} />
        <Route path="/film/:id" element={<FilmDetail />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/rainbow" element={<VirtualizedList />} />
        <Route path="/sync" element={<SyncPlayground />} />
        <Route path="/cursors" element={<MultiplayerCursors />} />
      </Routes>
    </div>
  );
}
