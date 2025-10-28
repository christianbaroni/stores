import type { MissionTheme } from './missionControlStore';

type ThemeTokens = {
  accent: string;
  background: string;
  card: string;
  glow: string;
  text: string;
  muted: string;
};

export const THEME_TOKENS: Record<MissionTheme, ThemeTokens> = {
  aurora: {
    accent: '#22D3EE',
    background: 'linear-gradient(135deg, #0F172A 0%, #312E81 48%, #0EA5E9 100%)',
    card: 'rgba(15, 23, 42, 0.55)',
    glow: '0 24px 48px rgba(14, 165, 233, 0.35)',
    muted: 'rgba(226, 232, 240, 0.7)',
    text: '#F8FAFC',
  },
  midnight: {
    accent: '#F472B6',
    background: 'linear-gradient(135deg, #111827 0%, #1E293B 50%, #7C3AED 100%)',
    card: 'rgba(15, 23, 42, 0.6)',
    glow: '0 24px 48px rgba(124, 58, 237, 0.4)',
    muted: 'rgba(226, 232, 240, 0.65)',
    text: '#F9FAFB',
  },
  solstice: {
    accent: '#F59E0B',
    background: 'linear-gradient(135deg, #0B1120 0%, #1E293B 55%, #F59E0B 100%)',
    card: 'rgba(15, 23, 42, 0.5)',
    glow: '0 24px 48px rgba(245, 158, 11, 0.35)',
    muted: 'rgba(226, 232, 240, 0.7)',
    text: '#F8FAFC',
  },
};
