import { RefObject, useEffect, useRef } from 'react';
import { animate, AnimationPlaybackControls } from 'framer-motion';
import { useListen } from 'stores';
import { ClickEffect, multiplayerCursorActions, useMultiplayerCursorStore } from '../../stores/multiplayerCursorStore';

// ============ Types ========================================================== //

type ClickEffectElement = {
  animations: AnimationPlaybackControls[];
  element: HTMLDivElement;
};

type Particle = {
  angle: number;
  distance: number;
  element: HTMLDivElement;
  scale: number;
  size: number;
};

// ============ Constants ====================================================== //

const PARTICLE_COUNT = 12;
const MIN_PARTICLE_SIZE = 4;
const MAX_PARTICLE_SIZE = 10;
const MIN_DISTANCE = 40;
const MAX_DISTANCE = 100;

// ============ Hook =========================================================== //

/**
 * ### `useClickEffectRenderer`
 *
 * Renders delightful click effects with particle bursts directly to the DOM
 * using `useListen`, bypassing React's render cycle for optimal performance.
 */
export function useClickEffectRenderer(containerRef: RefObject<HTMLElement | null>): void {
  const effectsMapRef = useRef<Map<string, ClickEffectElement>>(new Map());

  useListen(
    useMultiplayerCursorStore,
    state => state.clickEffects,
    currentEffects => {
      const container = containerRef.current;
      if (!container) return;

      const effectsMap = effectsMapRef.current;
      const currentEffectIds = new Set(currentEffects.map(effect => effect.id));

      for (const [effectId, effectElement] of effectsMap.entries()) {
        if (!currentEffectIds.has(effectId)) {
          removeEffect(effectsMap, effectId, effectElement);
        }
      }

      for (const effect of currentEffects) {
        if (!effectsMap.has(effect.id)) {
          createEffect(container, effectsMap, effect, () => {
            multiplayerCursorActions.removeClickEffect(effect.id);
          });
        }
      }
    }
  );

  useEffect(() => {
    const effectsMap = effectsMapRef.current;
    return () => {
      for (const [effectId, effectElement] of effectsMap.entries()) {
        removeEffect(effectsMap, effectId, effectElement);
      }
      effectsMap.clear();
    };
  }, []);
}

// ============ Effect Management ============================================== //

function createEffect(
  container: HTMLElement,
  effectsMap: Map<string, ClickEffectElement>,
  effect: ClickEffect,
  onComplete?: () => void
): void {
  const element = document.createElement('div');
  element.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(${effect.x}px, ${effect.y}px);
    pointer-events: none;
    z-index: 9998;
  `;

  const particles = createParticles(effect.color);
  const animations: AnimationPlaybackControls[] = [];

  for (const particle of particles) {
    element.appendChild(particle.element);

    const endX = Math.cos(particle.angle) * particle.distance;
    const endY = Math.sin(particle.angle) * particle.distance;

    const animation = animate(
      particle.element,
      {
        opacity: [1, 0.8, 0],
        scale: [0, particle.scale, 0],
        x: [0, endX],
        y: [0, endY],
      },
      {
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
      }
    );

    animations.push(animation);
  }

  const centerPulse = document.createElement('div');
  centerPulse.style.cssText = `
    position: absolute;
    left: -12px;
    top: -12px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid ${effect.color};
  `;
  element.appendChild(centerPulse);

  const pulseAnimation = animate(
    centerPulse,
    {
      opacity: [0.8, 0],
      scale: [0.5, 2.5],
    },
    {
      duration: 0.5,
      ease: 'easeOut',
    }
  );

  animations.push(pulseAnimation);
  container.appendChild(element);

  const effectElement: ClickEffectElement = { animations, element };
  effectsMap.set(effect.id, effectElement);

  Promise.all(animations.map(a => a.finished)).then(() => {
    removeEffect(effectsMap, effect.id, effectElement);
    onComplete?.();
  });
}

function createParticles(color: string): Particle[] {
  const particles: Particle[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.4;
    const distance = MIN_DISTANCE + Math.random() * (MAX_DISTANCE - MIN_DISTANCE);
    const size = MIN_PARTICLE_SIZE + Math.random() * (MAX_PARTICLE_SIZE - MIN_PARTICLE_SIZE);
    const scale = 0.8 + Math.random() * 0.4;

    const element = document.createElement('div');
    element.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: ${size}px;
      height: ${size}px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 0 ${size * 2}px ${color};
      will-change: transform;
    `;

    particles.push({ angle, distance, element, scale, size });
  }

  return particles;
}

function removeEffect(effectsMap: Map<string, ClickEffectElement>, effectId: string, effectElement: ClickEffectElement): void {
  const animations = effectElement.animations;
  const element = effectElement.element;
  for (const animation of animations) animation.stop();
  element.remove();
  effectsMap.delete(effectId);
}
