import { Route, Routes, Link, useLocation } from 'react-router-dom';
import { Favorites } from './components/Favorites';
import { FilmDetail } from './components/FilmDetail';
import { FilmList } from './components/FilmList';
import { SyncPlayground } from './components/SyncPlayground';
import { VirtualizedRainbowList } from './components/VirtualizedRainbowList';

export function App() {
  const location = useLocation();
  const isFilmRoute = location.pathname === '/' || location.pathname.startsWith('/film') || location.pathname === '/favorites';
  const isRainbowRoute = location.pathname.startsWith('/rainbow');
  const isSyncRoute = location.pathname.startsWith('/sync');

  return (
    <div style={{ minHeight: '100vh', background: isFilmRoute ? '#000' : '#f1f3f7' }}>
      <nav
        style={{
          display: 'flex',
          gap: 32,
          padding: '20px 24px',
          paddingTop: `max(20px, env(safe-area-inset-top))`,
          background: isFilmRoute ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderBottom: isFilmRoute ? '0.5px solid rgba(255, 255, 255, 0.1)' : '0.5px solid rgba(0, 0, 0, 0.1)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
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
          }}
        >
          Rainbow List
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
          }}
        >
          Sync Playground
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<FilmList />} />
        <Route path="/film/:id" element={<FilmDetail />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/rainbow" element={<VirtualizedRainbowList />} />
        <Route path="/sync" element={<SyncPlayground />} />
      </Routes>
    </div>
  );
}
