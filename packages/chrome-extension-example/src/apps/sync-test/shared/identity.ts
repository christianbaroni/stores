import type { ContextType, ExtensionContext } from './syncTestStore';

const PALETTE = ['#EC4899', '#6366F1', '#22D3EE', '#F97316', '#84CC16', '#F59E0B'];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function selectColor(label: string): string {
  const hash = hashString(label);
  return PALETTE[hash % PALETTE.length];
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function getOrCreateSessionId(contextType: ContextType): string {
  // Each window instance gets a unique sessionId via sessionStorage
  const storageKey = `session-id:${contextType}`;

  try {
    if (typeof sessionStorage !== 'undefined') {
      let sessionId = sessionStorage.getItem(storageKey);
      if (!sessionId) {
        sessionId = generateSessionId();
        sessionStorage.setItem(storageKey, sessionId);
      }
      return sessionId;
    }
  } catch {
    // sessionStorage not available
  }

  // Fallback for service workers (no sessionStorage)
  return `${contextType}-stable`;
}

export function createContext(type: ContextType, label: string): ExtensionContext {
  const normalizedLabel = label.trim().length ? label.trim() : `${type} context`;
  return {
    color: selectColor(normalizedLabel),
    label: normalizedLabel,
    sessionId: getOrCreateSessionId(type),
    type,
  };
}
