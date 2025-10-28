import { Link, useParams, useNavigate } from 'react-router-dom';
import { useFilmsStore } from '../stores/filmsStore';
import { addFavorite, removeFavorite, useFavoritesStore } from '../stores/favoritesStore';
import { useFilteredFilmsStore } from '../stores/filteredFilmsStore';
import { useState, useEffect } from 'react';
import { usePageBackground } from '../utils/usePageBackground';

export function FilmDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const film = useFilmsStore(s => s.getData()?.find(f => f.id === id));
  const isFavorited = useFavoritesStore(s => id && s.favorites[id] !== undefined);
  const filteredFilms = useFilteredFilmsStore();

  usePageBackground('#000000');

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Arrow Key Navigation
  useEffect(() => {
    if (isMobile || !filteredFilms || !id) return;

    const currentIndex = filteredFilms.findIndex(f => f.id === id);
    if (currentIndex === -1) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        navigate(`/film/${filteredFilms[currentIndex - 1].id}`);
      } else if (e.key === 'ArrowRight' && currentIndex < filteredFilms.length - 1) {
        navigate(`/film/${filteredFilms[currentIndex + 1].id}`);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isMobile, filteredFilms, id, navigate]);

  if (!film) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#000',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: 15 }}>Loading...</div>
      </div>
    );
  }

  const scoreColor = Number(film.rt_score) >= 80 ? '#30D158' : Number(film.rt_score) >= 60 ? '#FFD60A' : '#FF453A';

  const currentIndex = filteredFilms?.findIndex(f => f.id === id) ?? -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < (filteredFilms?.length ?? 0) - 1;
  const prevFilm = hasPrev ? filteredFilms![currentIndex - 1] : null;
  const nextFilm = hasNext ? filteredFilms![currentIndex + 1] : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        position: 'relative',
      }}
    >
      {/* Hero Banner */}
      <div
        className="hero-banner"
        style={{
          position: 'relative',
          height: '25vh',
          minHeight: 200,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            background: '#1a1a1a',
          }}
        />
        <img
          src={film.movie_banner}
          alt=""
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.3,
            filter: 'blur(1px)',
          }}
          loading="eager"
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              linear-gradient(to bottom, 
                rgba(0,0,0,0.1) 0%, 
                rgba(0,0,0,0.4) 60%, 
                rgba(0,0,0,0.9) 90%, 
                #000 100%
              )
            `,
          }}
        />
      </div>

      {/* Mobile Layout */}
      {isMobile && (
        <div
          style={{
            marginTop: -60,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              background: 'rgba(18, 18, 20, 0.95)',
              backdropFilter: 'blur(80px) saturate(180%)',
              WebkitBackdropFilter: 'blur(80px) saturate(180%)',
              borderRadius: '28px 28px 0 0',
              padding: '28px 20px',
              paddingBottom: 'max(32px, calc(32px + env(safe-area-inset-bottom, 0px)))',
              minHeight: '75vh',
              willChange: 'transform',
            }}
          >
            {/* Back Link */}
            <Link
              to="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginBottom: 24,
                fontSize: 17,
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Films
            </Link>

            {/* Title and Metadata */}
            <h1
              style={{
                fontSize: 36,
                fontWeight: 800,
                marginBottom: 8,
                letterSpacing: '-0.04em',
                lineHeight: 1.1,
              }}
            >
              {film.title}
            </h1>

            <p
              style={{
                fontSize: 15,
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: 20,
                lineHeight: 1.4,
                fontWeight: 500,
              }}
            >
              {film.original_title_romanised} • {film.original_title}
            </p>

            {/* Key Info */}
            <div
              style={{
                display: 'flex',
                gap: 20,
                marginBottom: 24,
                fontSize: 15,
                color: 'rgba(255, 255, 255, 0.6)',
              }}
            >
              <span>{film.release_date}</span>
              <span>{film.running_time} min</span>
              <span
                style={{
                  color: scoreColor,
                  fontWeight: 700,
                }}
              >
                {film.rt_score}%
              </span>
            </div>

            {/* Description */}
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.7,
                color: 'rgba(255, 255, 255, 0.7)',
                marginBottom: 28,
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              {film.description}
            </p>

            {/* Favorite Button */}
            <button
              onClick={() => {
                if (isFavorited) {
                  removeFavorite(film.id);
                } else {
                  addFavorite(film);
                }
              }}
              style={{
                width: '100%',
                padding: '18px',
                borderRadius: 16,
                border: 'none',
                background: isFavorited ? 'rgba(255, 69, 58, 1)' : 'rgba(10, 132, 255, 1)',
                color: '#fff',
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: 32,
                boxShadow: `0 8px 24px ${isFavorited ? 'rgba(255, 69, 58, 0.25)' : 'rgba(10, 132, 255, 0.25)'}`,
                transition: 'all 0.2s ease',
                transform: 'scale(1)',
              }}
              onMouseDown={e => {
                e.currentTarget.style.transform = 'scale(0.98)';
              }}
              onMouseUp={e => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>

            {/* Credits */}
            <div
              style={{
                paddingTop: 24,
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'grid',
                gap: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.3)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.08em' }}>
                  DIRECTOR
                </div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{film.director}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.3)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.08em' }}>
                  PRODUCER
                </div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{film.producer}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Layout */}
      {!isMobile && (
        <div
          style={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: 60,
            margin: '0 auto',
            marginTop: -80,
            maxWidth: 1200,
            padding: '0 40px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Poster */}
          <div
            style={{
              flexShrink: 0,
              position: 'sticky',
              top: 40,
              width: 320,
            }}
          >
            <div
              style={{
                borderRadius: 20,
                boxShadow: '0 40px 80px rgba(0, 0, 0, 0.4)',
                overflow: 'hidden',
                position: 'relative',
                transform: 'translateY(-20px)',
              }}
            >
              <img
                src={film.image}
                alt={film.title}
                style={{
                  display: 'block',
                  width: '100%',
                }}
              />
              <div
                style={{
                  background: 'linear-gradient(to top, rgba(0,0,0,0.1) 0%, transparent 20%)',
                  borderRadius: 20,
                  bottom: 0,
                  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
                  height: '100%',
                  inset: 0,
                  left: 0,
                  pointerEvents: 'none',
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  width: '100%',
                }}
              />
            </div>

            {/* Favorite Button */}
            <button
              onClick={() => {
                if (isFavorited) {
                  removeFavorite(film.id);
                } else {
                  addFavorite(film);
                }
              }}
              style={{
                marginTop: 24,
                width: '100%',
                padding: '16px 24px',
                borderRadius: 16,
                border: 'none',
                background: isFavorited ? 'rgba(255, 69, 58, 1)' : 'rgba(10, 132, 255, 1)',
                color: '#fff',
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                boxShadow: `0 12px 32px ${isFavorited ? 'rgba(255, 69, 58, 0.3)' : 'rgba(10, 132, 255, 0.3)'}`,
                transition: 'all 0.2s ease',
                transform: 'translateY(0)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 16px 40px ${isFavorited ? 'rgba(255, 69, 58, 0.4)' : 'rgba(10, 132, 255, 0.4)'}`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 12px 32px ${isFavorited ? 'rgba(255, 69, 58, 0.3)' : 'rgba(10, 132, 255, 0.3)'}`;
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorited ? 'white' : 'none'} stroke="white" strokeWidth="2.5">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {isFavorited ? 'Favorited' : 'Add to Favorites'}
            </button>
          </div>

          {/* Content */}
          <div
            style={{
              flex: 1,
              paddingTop: 20,
            }}
          >
            {/* Back Link */}
            <Link
              to="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 32,
                fontSize: 17,
                color: 'rgba(255, 255, 255, 0.4)',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                e.currentTarget.style.transform = 'translateX(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)';
                e.currentTarget.style.transform = 'translateX(0)';
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Films
            </Link>

            {/* Title */}
            <h1
              style={{
                fontSize: 64,
                fontWeight: 800,
                marginBottom: 12,
                letterSpacing: '-0.05em',
                lineHeight: 0.95,
              }}
            >
              {film.title}
            </h1>

            {/* Subtitle */}
            <p
              style={{
                fontSize: 20,
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: 32,
                lineHeight: 1.3,
                fontWeight: 500,
              }}
            >
              {film.original_title_romanised} • {film.original_title}
            </p>

            {/* Film Metadata */}
            <div
              style={{
                display: 'flex',
                gap: 32,
                marginBottom: 40,
                paddingBottom: 40,
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              {[
                { label: 'Year', value: film.release_date },
                { label: 'Runtime', value: `${film.running_time} min` },
                { label: 'Director', value: film.director },
                { label: 'Producer', value: film.producer },
                { label: 'Score', value: `${film.rt_score}%`, isScore: true },
              ].map(item => (
                <div key={item.label}>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'rgba(255, 255, 255, 0.3)',
                      marginBottom: 6,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      ...(item.isScore && {
                        color: scoreColor,
                        fontWeight: 700,
                      }),
                    }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Description */}
            <p
              style={{
                fontSize: 19,
                lineHeight: 1.7,
                color: 'rgba(255, 255, 255, 0.7)',
                maxWidth: 640,
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              {film.description}
            </p>
          </div>
        </div>
      )}

      {/* Desktop Navigation */}
      {!isMobile && (
        <>
          {/* Previous Film Link */}
          {hasPrev && prevFilm && (
            <Link
              to={`/film/${prevFilm.id}`}
              style={{
                position: 'fixed',
                left: 20,
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '16px 8px',
                color: 'rgba(255, 255, 255, 0.2)',
                transition: 'all 0.2s ease',
                textDecoration: 'none',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                e.currentTarget.style.transform = 'translateY(-50%) translateX(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(-50%)';
              }}
              title={prevFilm.title}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
          )}

          {/* Next Film Link */}
          {hasNext && nextFilm && (
            <Link
              to={`/film/${nextFilm.id}`}
              style={{
                position: 'fixed',
                right: 20,
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '16px 8px',
                color: 'rgba(255, 255, 255, 0.2)',
                transition: 'all 0.2s ease',
                textDecoration: 'none',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                e.currentTarget.style.transform = 'translateY(-50%) translateX(2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(-50%)';
              }}
              title={nextFilm.title}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </Link>
          )}
        </>
      )}

      <style>{`
        @media (min-width: 768px) {
          .hero-banner {
            height: 30vh !important;
            min-height: 280px !important;
          }
        }
      `}</style>
    </div>
  );
}
