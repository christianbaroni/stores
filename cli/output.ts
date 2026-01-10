import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { dim, green, red } from './style';
import { formatTime } from './format';
import { Layout, Symbol } from './tokens';

type ErrorSource = 'message' | 'stderr' | 'stdout';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Prompt for yes/no confirmation. */
export function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${message} ${dim('(y/N)')} `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/** Execute a shell command synchronously. Throws on non-zero exit. */
export function exec(cmd: string, cwd: string): void {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
  } catch (err) {
    throw new Error(getErrorOutput(err, 'stderr', 'stdout') ?? `Command failed: ${cmd}`);
  }
}

/** Display an error and exit. */
export function handleError(err: unknown): never {
  const output = getErrorOutput(err, 'stderr', 'stdout', 'message');
  process.stdout.write(`${red('Error:')} ${output}\n\n`);
  process.exit(1);
}

/** Wrap an async main function with error handling. */
export function main(fn: () => Promise<void>): void {
  fn().catch(handleError);
}

/** Create an animated spinner. Returns no-op in non-TTY environments. */
export function spinner(message: string): { stop: () => void } {
  if (!process.stdout.isTTY) return { stop: () => {} };

  let frame = 0;
  const interval = setInterval(() => {
    const indicator = SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length];
    process.stdout.write(`\r${Layout.Indent}${dim(`${indicator} ${message}`)}`);
  }, 50);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K');
    },
  };
}

/** Execute a step with timing. Does NOT emit trailing newline. */
export function step(name: string, fn: () => void): void {
  const start = Date.now();
  try {
    fn();
    process.stdout.write(`${Layout.Indent}${green(Symbol.Check)} ${name.padEnd(Layout.NameWidth)} ${dim(formatTime(Date.now() - start))}`);
  } catch (err) {
    process.stdout.write(`${Layout.Indent}${red(Symbol.Cross)} ${name.padEnd(Layout.NameWidth)} ${dim(formatTime(Date.now() - start))}`);
    throw err;
  }
}

/** Write to stdout. Joins arguments with newlines. */
export function write(...lines: string[]): void {
  process.stdout.write(lines.join('\n'));
}

function getErrorOutput(err: unknown, ...sources: ErrorSource[]): string | undefined {
  if (!(err instanceof Error)) return String(err);
  const get: Record<ErrorSource, () => string | undefined> = {
    message: () => err.message,
    stderr: () => getStderr(err),
    stdout: () => getStdout(err),
  };
  for (const source of sources) {
    const value = get[source]();
    if (value) return value;
  }
}

function getStderr(err: Error): string | undefined {
  if ('stderr' in err) return err.stderr?.toString().trim() || undefined;
}

function getStdout(err: Error): string | undefined {
  if ('stdout' in err) return err.stdout?.toString().trim() || undefined;
}
