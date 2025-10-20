import { IS_DEV } from '@env';

export class StoresError extends Error {
  cause: Error;
  constructor(message: string, error?: unknown) {
    super(message);
    this.name = 'StoresError';
    this.cause = ensureError(error);
  }
}

export const logger = {
  error: (error: Error, context?: Record<string, unknown>) => {
    if (IS_DEV) console.error(error, context);
  },
  info: (message: string, context?: Record<string, unknown>) => {
    if (IS_DEV) console.info(message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    if (IS_DEV) console.warn(message, context);
  },
};

export function ensureError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
