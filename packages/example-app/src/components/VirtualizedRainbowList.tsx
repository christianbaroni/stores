'use no memo';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef } from 'react';
import { useFilteredRainbowListStore, setRainbowListQuery } from '../stores/rainbowListStore';

export function VirtualizedRainbowList() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = useFilteredRainbowListStore();

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 15,
  });

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [items]);

  return (
    <div style={{ padding: 32, fontFamily: 'Inter, sans-serif', background: '#f7f9fb', height: 'calc(100vh - 50px)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>🌈 Rainbow Virtualized List</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        10,000 users, instant search, virtualized rendering. Try searching for a name, company, city, or status!
      </p>
      <input
        type="text"
        onChange={e => setRainbowListQuery(e.target.value)}
        placeholder="Search by any field..."
        style={{
          padding: '10px 16px',
          fontSize: 16,
          borderRadius: 6,
          border: '1px solid #d0d7de',
          marginBottom: 24,
          width: 320,
          maxWidth: '100%',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          background: '#f1f3f7',
          border: '1px solid #e0e6ed',
          borderBottom: 'none',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <div style={headerStyle(80, 'right')}>ID</div>
        <div style={headerStyle(160, 'left')}>Name</div>
        <div style={headerStyle(220, 'left')}>Email</div>
        <div style={headerStyle(140, 'left')}>Company</div>
        <div style={headerStyle(120, 'left')}>City</div>
        <div style={headerStyle(100, 'center')}>Status</div>
        <div style={headerStyle(100, 'right')}>Value</div>
        <div style={headerStyle(120, 'center')}>Date</div>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        style={{
          height: 600,
          width: '100%',
          overflow: 'auto',
          border: '1px solid #e0e6ed',
          borderTop: 'none',
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8,
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const item = items[virtualRow.index];
            return (
              <div
                key={item.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: 48,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid #f0f1f3',
                  background: virtualRow.index % 2 === 0 ? '#fcfdff' : '#f7f9fb',
                  transition: 'background 0.2s',
                  cursor: 'pointer',
                }}
                onMouseOver={e => (e.currentTarget.style.background = '#e6f0fa')}
                onMouseOut={e => (e.currentTarget.style.background = virtualRow.index % 2 === 0 ? '#fcfdff' : '#f7f9fb')}
              >
                <div style={tdStyle(80, 'right', 600)}>{item.id}</div>
                <div style={tdStyle(160, 'left', 600, 700)}>{item.name}</div>
                <div style={tdStyle(220, 'left', 600, 900)}>{item.email}</div>
                <div style={tdStyle(140, 'left', 600, 800)}>{item.company}</div>
                <div style={tdStyle(120, 'left', 600, 700)}>{item.city}</div>
                <div style={tdStyle(100, 'center', 600, 700)}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: 12,
                      fontWeight: 600,
                      fontSize: 13,
                      color: statusColor(item.status).color,
                      background: statusColor(item.status).bg,
                    }}
                  >
                    {item.status}
                  </span>
                </div>
                <div style={tdStyle(100, 'right', 600, 700)}>${item.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                <div style={tdStyle(120, 'center', 600, 700)}>{item.date}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 16, color: '#888', fontSize: 14 }}>
        Showing <b>{items.length.toLocaleString()}</b> result{items.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function headerStyle(minWidth: number, align: 'left' | 'right' | 'center' = 'left'): React.CSSProperties {
  return {
    flex: `0 0 ${minWidth}px`,
    minWidth,
    maxWidth: minWidth + 40,
    textAlign: align,
    padding: '12px 10px',
    fontWeight: 700,
    fontSize: 15,
    color: '#222',
    letterSpacing: 0.1,
    userSelect: 'none',
    boxSizing: 'border-box',
  };
}

function tdStyle(minWidth: number, align: 'left' | 'right' | 'center' = 'left', _minScreen = 0, _maxScreen = 9999): React.CSSProperties {
  return {
    flex: `0 0 ${minWidth}px`,
    minWidth,
    maxWidth: minWidth + 40,
    textAlign: align,
    padding: '8px 10px',
    fontSize: 15,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block',
    boxSizing: 'border-box',
  };
}

function statusColor(status: string) {
  switch (status) {
    case 'Active':
      return { color: '#217a3c', bg: '#e6f4ea' };
    case 'Inactive':
      return { color: '#a12d2f', bg: '#fbeaea' };
    case 'Pending':
      return { color: '#b47a1b', bg: '#fff7e0' };
    default:
      return { color: '#444', bg: '#eee' };
  }
}
