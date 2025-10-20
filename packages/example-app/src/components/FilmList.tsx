import { Link } from 'react-router-dom';
import { addFavorite, removeFavorite, useFavoritesStore } from '../stores/favoritesStore';
import { useFilteredFilmsStore } from '../stores/filteredFilmsStore';
import { setQuery, useSearchStore } from '../stores/searchStore';
import { getSortBy, setSortBy, toggleSortOrder, useSortStore } from '../stores/sortStore';
import { useStableValue } from '@stores';

export function FilmList() {
  const favorites = useFavoritesStore(s => s.favorites);
  const films = useFilteredFilmsStore();
  const sortOrder = useSortStore(s => s.sortOrder);
  const sortBy = useSortStore(s => s.sortBy);

  const initialQuery = useStableValue(() => useSearchStore.getState().query);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        paddingBottom: 60,
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
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 28,
              gap: 16,
            }}
          >
            <h1
              style={{
                fontSize: 48,
                fontWeight: 800,
                letterSpacing: '-0.04em',
                margin: 0,
                lineHeight: 0.9,
              }}
            >
              Films
            </h1>
            <Link
              to="/favorites"
              style={{
                fontSize: 17,
                color: '#0A84FF',
                fontWeight: 600,
                padding: '8px 0',
                letterSpacing: '-0.01em',
              }}
            >
              Favorites
            </Link>
          </div>

          {/* Search and Filters */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'stretch',
            }}
          >
            <div
              style={{
                flex: 1,
                position: 'relative',
              }}
            >
              <input
                type="text"
                onChange={e => setQuery(e.target.value)}
                placeholder="Search"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 16px',
                  paddingRight: 40,
                  background: 'rgba(118, 118, 128, 0.12)',
                  border: 'none',
                  borderRadius: 20,
                  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.025)',
                  color: '#fff',
                  fontSize: 17,
                  fontWeight: 400,
                  outline: 'none',
                  WebkitAppearance: 'none',
                  letterSpacing: '-0.01em',
                }}
                defaultValue={initialQuery}
              />
              {/* <button
                  onClick={() => setQuery('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    border: 'none',
                    background: 'rgba(174, 174, 178, 0.3)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                >
                ×
              </button> */}
            </div>

            <select
              value={sortBy}
              onChange={e => setSortBy(getSortBy(e.target.value))}
              style={{
                height: 40,
                padding: '0 36px 0 16px',
                background: 'rgba(118, 118, 128, 0.12)',
                border: 'none',
                borderRadius: 12,
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.025)',
                color: '#fff',
                fontSize: 17,
                fontWeight: 500,
                outline: 'none',
                cursor: 'pointer',
                WebkitAppearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='rgba(255,255,255,0.6)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 14px center',
                minWidth: 0,
                letterSpacing: '-0.01em',
              }}
            >
              <option value="title">Title</option>
              <option value="release_date">Date</option>
              <option value="rt_score">Score</option>
            </select>

            <button
              onClick={toggleSortOrder}
              style={{
                width: 40,
                height: 40,
                padding: 0,
                background: 'rgba(118, 118, 128, 0.12)',
                border: 'none',
                borderRadius: 12,
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.025)',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: 20,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-label={sortOrder === 'asc' ? 'Sort descending' : 'Sort ascending'}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: sortOrder === 'desc' ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease',
                  lineHeight: 1,
                }}
              >
                ↑
              </span>
            </button>
          </div>
        </header>

        {/* Films Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, calc((100vw - 48px) / 2)), 1fr))',
            gap: 16,
          }}
        >
          {films?.map(film => (
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
                      marginBottom: 4,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {film.title}
                  </h3>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      color: 'rgba(255, 255, 255, 0.5)',
                      fontWeight: 500,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    <span>{film.release_date}</span>
                    <span style={{ opacity: 0.3 }}>•</span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: Number(film.rt_score) >= 80 ? '#30D158' : Number(film.rt_score) >= 60 ? '#FFD60A' : '#FF453A',
                      }}
                    >
                      {film.rt_score}%
                    </span>
                  </div>
                </div>
              </Link>

              {/* Favorite Button */}
              <button
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  border: 'none',
                  background: favorites[film.id] ? 'rgba(255, 69, 58, 0.95)' : 'rgba(28, 28, 30, 0.8)',
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
                  if (favorites[film.id]) {
                    removeFavorite(film.id);
                  } else {
                    addFavorite(film);
                  }
                }}
                aria-label={favorites[film.id] ? 'Remove from favorites' : 'Add to favorites'}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill={favorites[film.id] ? 'white' : 'none'}
                  stroke="white"
                  strokeWidth="2"
                  strokeOpacity={favorites[film.id] ? 1 : 0.7}
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
