#!/usr/bin/env tsx
import { exec } from 'child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { bold, formatSize, handleError, spinner, summary, timedRow, write } from '@/cli';
import { plugins } from '../build/plugins';

const execAsync = promisify(exec);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

build().catch(err => {
  write(summary('build', { success: false }));
  handleError(err);
});

async function build(): Promise<void> {
  const start = performance.now();

  rmSync(join(root, 'dist'), { recursive: true, force: true });
  copyFilesFromRoot(['LICENSE', 'README.md']);

  write(`${bold('stores')}\n`);
  const spin = spinner(' exports · types · web · native');
  write('\n');

  const [exports, types, web, native] = await Promise.all([
    timed(() => execAsync('tsx --tsconfig scripts/tsconfig.json scripts/generate-exports.ts', { cwd: root })),
    buildTypes(),
    buildPlatform('web'),
    buildPlatform('native'),
  ]).finally(spin.stop);

  write(
    timedRow('exports', exports.time),
    timedRow('types', types.time),
    timedRow('web', web.time, bundleSummary('dist/web')),
    timedRow('native', native.time, bundleSummary('dist/native')),
    summary('build', { time: performance.now() - start })
  );
}

async function buildTypes(): Promise<{ time: number }> {
  const start = performance.now();
  await execAsync('tsc -p tsconfig.build.json --emitDeclarationOnly', { cwd: root });
  removeDisabledPluginTypes();
  return { time: performance.now() - start };
}

async function buildPlatform(platform: 'web' | 'native'): Promise<{ time: number }> {
  const start = performance.now();
  const env = { ...process.env, NODE_ENV: 'production', ...(platform === 'native' && { BUILD_TARGET: 'native' }) };
  await execAsync(`tsup --config tsup.config.ts --out-dir dist/${platform}`, { cwd: root, env });
  return { time: performance.now() - start };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ time: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { time: performance.now() - start, result };
}

function bundleSummary(dir: string): string {
  const fullPath = join(root, dir);
  const files = readdirSync(fullPath);
  const fileSize = (name: string) => (files.includes(`${name}.mjs`) ? statSync(join(fullPath, `${name}.mjs`)).size : 0);

  const totalSize = files.filter(f => f.endsWith('.mjs')).reduce((sum, f) => sum + statSync(join(fullPath, f)).size, 0);
  const pluginsSize = Object.keys(plugins).reduce((sum, name) => sum + fileSize(name), 0);
  const coreSize = totalSize - pluginsSize;

  return `${formatSize(totalSize)} · core ${formatSize(coreSize)} · plugins ${formatSize(pluginsSize)}`;
}

function copyFilesFromRoot(files: string[]): void {
  for (const file of files) {
    copyFileSync(join(root, '../..', file), join(root, file));
  }
}

function removeDisabledPluginTypes(): void {
  const srcPlugins = join(root, 'src/plugins');
  const distPlugins = join(root, 'dist/plugins');

  const allPluginDirs = readdirSync(srcPlugins).filter(name => statSync(join(srcPlugins, name)).isDirectory());

  for (const name of allPluginDirs) {
    if (!(name in plugins)) {
      rmSync(join(distPlugins, name), { recursive: true, force: true });
    }
  }
}
