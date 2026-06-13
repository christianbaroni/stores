import { IS_DEV, IS_TEST } from '@/env';

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  error: {
    <T extends Error>(error: T, context?: Record<string, unknown>): void;
    <T extends string>(error: T, context?: Record<string, unknown>): void;
  };
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
}

/** @internal */
export let logger: Logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    if (IS_DEV) console.debug(message, context);
  },
  error: (error: Error, context?: Record<string, unknown>) => {
    if (IS_DEV && !IS_TEST) console.error(error, context);
  },
  info: (message: string, context?: Record<string, unknown>) => {
    if (IS_DEV) console.info(message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    if (IS_DEV) console.warn(message, context);
  },
};

/** @internal */
export function setLogger(customLogger: Logger): void {
  logger = customLogger;
}
