/**
 * Error reported or thrown by the stores package itself.
 *
 * If an underlying thrown value caused the failure, it is available as `cause`.
 */
export class StoresError extends Error {
  declare cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StoresError';
    if (cause === undefined) return;

    Object.defineProperty(this, 'cause', {
      configurable: true,
      value: cause,
      writable: true,
    });
  }
}

/**
 * Normalizes unknown errors into `Error`.
 * @internal
 */
export function ensureError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
