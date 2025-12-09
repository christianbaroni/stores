import { Link } from 'react-router-dom';
import { removeFavorite, useFavoritesStore } from '../stores/favoritesStore';
import { usePageBackground } from '../utils/usePageBackground';

export function Favorites() {
  const favorites = useFavoritesStore(s => Object.values(s.favorites));

  usePageBackground('#000000');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        paddingBottom: 'max(60px, env(safe-area-inset-bottom))',
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '0 16px',
        }}
      >
        {/* Header */}
        <header
          style={{
            paddingTop: 'max(40px, env(safe-area-inset-top))',
            paddingBottom: 32,
          }}
        >
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginBottom: 20,
              fontSize: 17,
              color: '#0A84FF',
              fontWeight: 600,
              gap: 4,
              letterSpacing: '-0.01em',
            }}
          >
            ‹ Films
          </Link>

          <h1
            style={{
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              margin: 0,
              lineHeight: 0.9,
            }}
          >
            Favorites
          </h1>
        </header>

        {/* Content */}
        {favorites.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              paddingTop: '25vh',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                margin: '0 auto 20px',
                borderRadius: 32,
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.3)" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <p
              style={{
                fontSize: 17,
                color: 'rgba(255, 255, 255, 0.5)',
                marginBottom: 28,
                lineHeight: 1.4,
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              No favorites yet
            </p>
            <Link
              to="/"
              style={{
                display: 'inline-block',
                padding: '14px 32px',
                background: '#0A84FF',
                color: '#fff',
                borderRadius: 12,
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: '-0.01em',
              }}
            >
              Browse Films
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, calc((100vw - 48px) / 2)), 1fr))',
              gap: 16,
            }}
          >
            {favorites.map(film => (
              <div
                key={film.id}
                style={{
                  position: 'relative',
                  width: '100%',
                }}
              >
                <Link to={`/film/${film.id}`}>
                  <div
                    style={{
                      position: 'relative',
                      paddingBottom: '150%',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#1c1c1e',
                      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
                    }}
                  >
                    <img
                      src={film.image}
                      alt={film.title}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <h3
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        margin: 0,
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {film.title}
                    </h3>
                  </div>
                </Link>

                {/* Remove Button */}
                <button
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    border: 'none',
                    background: 'rgba(255, 69, 58, 0.95)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    zIndex: 1,
                  }}
                  onClick={e => {
                    e.preventDefault();
                    removeFavorite(film.id);
                  }}
                  aria-label="Remove from favorites"
                >
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <line x1="1" y1="1" x2="13" y2="13"></line>
                    <line x1="13" y1="1" x2="1" y2="13"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
