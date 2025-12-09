import { FieldMetadata } from './types';

/**
 * Helper to create `FieldMetadata` tuples.
 */
export function createFieldMetadata(timestamp: number, sessionId: string): FieldMetadata {
  return [timestamp, sessionId];
}
