/** Format bytes as human-readable size. */
export function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1000 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
}

/** Format milliseconds as human-readable duration. */
export function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
