import { execSync } from 'child_process';

// ============ Text Formatting ================================================ //

export enum Text {
  /* -- Styles -- */
  Bold = '\x1b[1m',
  Reset = '\x1b[0m',
  /* -- Colors -- */
  Blue = '\x1b[34m',
  Dim = '\x1b[2m',
  Gray = '\x1b[38;5;245m',
  Green = '\x1b[32m',
  Orange = '\x1b[38;5;208m',
  Red = '\x1b[31m',
  Yellow = '\x1b[33m',
}

export function text(text: string, style: keyof typeof Text): string {
  return `${Text[style]}${text}${Text.Reset}`;
}

// ============ CLI Utilities ================================================== //

export function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1000 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
}

export function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

/**
 * Inserts line breaks and writes to the console.
 */
export function printLines(...lines: string[]): void {
  process.stdout.write(lines.join('\n'));
}

/**
 * Runs a step with timing, shows ✓ on success or ✗ on failure.
 */
export function step(name: string, fn: () => void): void {
  const start = Date.now();
  try {
    fn();
    process.stdout.write(`  ${Text.Green}✓${Text.Reset} ${name.padEnd(8)} ${Text.Dim}${formatTime(Date.now() - start)}${Text.Reset}`);
  } catch (err) {
    process.stdout.write(`  ${Text.Red}✗${Text.Reset} ${name.padEnd(8)} ${Text.Dim}${formatTime(Date.now() - start)}${Text.Reset}`);
    throw err;
  }
}

export function exec(cmd: string, cwd: string): void {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
  } catch (err) {
    throw new Error(getErrorOutput(err, 'stderr', 'stdout') ?? `Command failed: ${cmd}`);
  }
}

export function handleError(err: unknown): never {
  const output = getErrorOutput(err, 'stderr', 'stdout', 'message');
  process.stdout.write(`${Text.Red}Error:${Text.Reset} ${output}\n\n`);
  process.exit(1);
}

// ============ Spinner ======================================================== //

/**
 * Creates a CLI spinner. Must be stopped via `spinner.stop()`.
 */
export function createSpinner(message: string): { stop: () => void } {
  if (!process.stdout.isTTY) return { stop: () => {} };

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${Text.Dim}${frames[i++ % frames.length]} ${message}${Text.Reset}`);
  }, 50);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K');
    },
  };
}

// ============ Helpers ======================================================== //

function getErrorOutput(err: unknown, ...sources: ('stderr' | 'stdout' | 'message')[]): string | undefined {
  if (!(err instanceof Error)) return String(err);
  const get = {
    stderr: () => getStderr(err),
    stdout: () => getStdout(err),
    message: () => err.message,
  };
  for (const source of sources) {
    const value = get[source]();
    if (value) return value;
  }
}

function getStderr(err: Error): string | undefined {
  if ('stderr' in err) return err.stderr?.toString().trim() || undefined;
  return undefined;
}

function getStdout(err: Error): string | undefined {
  if ('stdout' in err) return err.stdout?.toString().trim() || undefined;
  return undefined;
}
