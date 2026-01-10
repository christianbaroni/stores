import { IS_DEV, IS_TEST } from '@/env';

export class StoresError extends Error {
  cause: Error;
  constructor(message: string, error?: unknown) {
    super(message);
    this.name = 'StoresError';
    this.cause = ensureError(error);
  }
}

export interface StoresLogger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  error: {
    <T extends Error>(error: T, context?: Record<string, unknown>): void;
    <T extends string>(error: T, context?: Record<string, unknown>): void;
  };
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
}

export let logger: StoresLogger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    if (IS_DEV) console.debug(message, context);
  },
  error: (error: Error, context?: Record<string, unknown>) => {
    if (!IS_TEST) console.error(error, context);
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

export function setLogger(customLogger: StoresLogger): void {
  logger = customLogger;
}
