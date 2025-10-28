import { RefObject, useEffect, useRef } from 'react';
import { animate, AnimationOptions, AnimationPlaybackControls } from 'framer-motion';
import { useListen } from '@stores';
import { ActiveCursor, useActiveCursorsStore } from '../../stores/activeCursorsStore';

// ============ Types ========================================================== //

type CursorElement = {
  animations: Map<string, AnimationPlaybackControls>;
  containerEl: HTMLDivElement;
  labelEl: HTMLDivElement;
};

// ============ Constants ====================================================== //

const CURSOR_SIZE = 24;
const CURSOR_LABEL_OFFSET = 16;
const ANIMATION_CONFIG: AnimationOptions = {
  duration: 0.12,
  ease: [0.16, 1, 0.3, 1],
};

// ============ Hook =========================================================== //

/**
 * ### `useCursorRenderer`
 *
 * Renders multiplayer cursors directly to the DOM using `useListen`,
 * bypassing React's render cycle entirely for maximum performance.
 */
export function useCursorRenderer(containerRef: RefObject<HTMLElement | null>): void {
  const cursorsMapRef = useRef<Map<string, CursorElement>>(new Map());

  useListen(
    useActiveCursorsStore,
    state => state,
    currentCursors => {
      const container = containerRef.current;
      if (!container) return;

      const cursorsMap = cursorsMapRef.current;
      const currentSessionIds = new Set(currentCursors.map(c => c.sessionId));

      // Remove cursors that are no longer active
      for (const entry of cursorsMap.entries()) {
        const sessionId = entry[0];
        const cursorElement = entry[1];
        if (!currentSessionIds.has(sessionId)) {
          removeCursor(cursorsMap, sessionId, cursorElement);
        }
      }

      // Update or create cursors
      for (const cursor of currentCursors) {
        const existing = cursorsMap.get(cursor.sessionId);
        if (existing) {
          updateCursor(existing, cursor);
        } else {
          createCursor(container, cursorsMap, cursor);
        }
      }
    }
  );

  useEffect(() => {
    const cursorsMap = cursorsMapRef.current;
    return () => {
      for (const [sessionId, cursorElement] of cursorsMap.entries()) {
        removeCursor(cursorsMap, sessionId, cursorElement);
      }
      cursorsMap.clear();
    };
  }, []);
}

// ============ Cursor Management ============================================== //

function createCursor(container: HTMLElement, cursorsMap: Map<string, CursorElement>, cursor: ActiveCursor): void {
  const containerEl = document.createElement('div');
  containerEl.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 9999;
    will-change: transform;
    left: 0;
    top: 0;
  `;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('width', String(CURSOR_SIZE));
  svgEl.setAttribute('height', String(CURSOR_SIZE));
  svgEl.setAttribute('viewBox', '0 0 24 24');
  svgEl.setAttribute('fill', 'none');
  svgEl.style.cssText = `
    display: block;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.3));
  `;

  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathEl.setAttribute(
    'd',
    'M5.65 2.15a.5.5 0 0 1 .7-.5l15 6a.5.5 0 0 1 .1.9l-6.9 4.4 3.6 6.8a.5.5 0 0 1-.8.6l-4.2-5.2-5.2 3.3a.5.5 0 0 1-.7-.6l-1.5-15.6z'
  );
  pathEl.setAttribute('fill', cursor.color);
  pathEl.setAttribute('stroke', '#fff');
  pathEl.setAttribute('stroke-width', '1.5');
  pathEl.setAttribute('stroke-linejoin', 'round');

  svgEl.appendChild(pathEl);
  containerEl.appendChild(svgEl);

  const labelEl = document.createElement('div');
  labelEl.textContent = cursor.displayName;
  labelEl.style.cssText = `
    position: absolute;
    left: ${CURSOR_LABEL_OFFSET}px;
    top: ${CURSOR_LABEL_OFFSET}px;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid ${cursor.color};
    color: ${cursor.color};
    padding: 5px 11px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.1);
    user-select: none;
  `;

  containerEl.appendChild(labelEl);
  container.appendChild(containerEl);

  const animations = new Map<string, AnimationPlaybackControls>();
  const cursorElement: CursorElement = { animations, containerEl, labelEl };

  cursorsMap.set(cursor.sessionId, cursorElement);

  containerEl.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
}

function updateCursor(cursorElement: CursorElement, cursor: ActiveCursor): void {
  const { animations, containerEl, labelEl } = cursorElement;

  const positionAnimation = animations.get('position');
  if (positionAnimation) {
    positionAnimation.stop();
  }

  const newAnimation = animate(containerEl, { x: cursor.x, y: cursor.y }, ANIMATION_CONFIG);

  animations.set('position', newAnimation);

  if (labelEl.textContent !== cursor.displayName) {
    labelEl.textContent = cursor.displayName;
  }
}

function removeCursor(cursorsMap: Map<string, CursorElement>, sessionId: string, cursorElement: CursorElement): void {
  const { animations, containerEl } = cursorElement;

  for (const animation of animations.values()) animation.stop();
  animations.clear();

  const fadeAnimation = animate(containerEl, { opacity: 0, scale: 0.8 }, { duration: 0.2, ease: 'easeOut' });

  fadeAnimation.then(() => {
    containerEl.remove();
    cursorsMap.delete(sessionId);
  });
}
