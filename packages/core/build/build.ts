#!/usr/bin/env tsx
import { exec } from 'child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { Text, createSpinner, formatSize, formatTime, handleError, printLines } from './cli';
import { plugins } from './plugins';

const execAsync = promisify(exec);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

build().catch(handleError);

// ============ Package Builder ================================================ //

async function build(): Promise<void> {
  const start = performance.now();

  rmSync(join(root, 'dist'), { recursive: true, force: true });
  copyFileSync(join(root, '../../README.md'), join(root, 'README.md'));

  process.stdout.write(`${Text.Bold}stores${Text.Reset}\n`);
  const spinner = createSpinner(' exports · types · web · native');
  process.stdout.write('\n');

  const [exports, types, web, native] = await Promise.all([
    timed(() => execAsync('tsx scripts/generate-exports.ts', { cwd: root })),
    timed(() => execAsync('tsc -p tsconfig.build.json --emitDeclarationOnly', { cwd: root })),
    buildPlatform('web'),
    buildPlatform('native'),
  ]).finally(spinner.stop);

  printLines(
    buildSuccessRow('exports', exports.time),
    buildSuccessRow('types', types.time),
    buildSuccessRow('web', web.time, web.summary),
    buildSuccessRow('native', native.time, native.summary),
    buildSuccessRow('duration', performance.now() - start)
  );
}

// ============ Helpers ======================================================== //

async function buildPlatform(platform: 'web' | 'native'): Promise<{ time: number; summary: string }> {
  const start = performance.now();
  const env = { ...process.env, NODE_ENV: 'production', ...(platform === 'native' && { BUILD_TARGET: 'native' }) };
  await execAsync(`tsup --config tsup.config.ts --out-dir dist/${platform}`, { cwd: root, env });
  return { time: performance.now() - start, summary: bundleSummary(`dist/${platform}`) };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ time: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { time: performance.now() - start, result };
}

function bundleSummary(dir: string): string {
  const fullPath = join(root, dir);
  const files = readdirSync(fullPath);
  const getSize = (name: string) => (files.includes(`${name}.mjs`) ? statSync(join(fullPath, `${name}.mjs`)).size : 0);
  const coreSize = getSize('index');
  const pluginsSize = Object.keys(plugins).reduce((sum, name) => sum + getSize(name), 0);
  return `${formatSize(coreSize + pluginsSize)} · core ${formatSize(coreSize)} · plugins ${formatSize(pluginsSize)}`;
}

function buildSuccessRow(name: 'exports' | 'types' | 'web' | 'native' | 'duration', time: number, summary?: string): string {
  switch (name) {
    case 'web':
    case 'native':
      return `  ${Text.Green}✓${Text.Reset} ${name.padEnd(8)} ${Text.Dim}${formatTime(time)}${Text.Reset}   ${Text.Dim}${summary}${Text.Reset}`;
    case 'duration':
      return `\n  ${Text.Green}✓ ${'build'.padEnd(8)}${Text.Reset} ${Text.Dim}${formatTime(time)}${Text.Reset}\n\n`;
    default:
      return `  ${Text.Green}✓${Text.Reset} ${name.padEnd(8)} ${Text.Dim}${formatTime(time)}${Text.Reset}`;
  }
}
