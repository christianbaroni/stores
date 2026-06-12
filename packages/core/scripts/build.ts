#!/usr/bin/env tsx
import { exec } from 'child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { bold, formatSize, handleError, spinner, summary, timedRow, write } from '@/cli';
import { disabledPluginTypeRoots, pluginBuildEntries, type Platform } from '../build/plugins';

// ============ Script ========================================================= //

const execAsync = promisify(exec);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

build().catch(e => {
  write(summary('build', { success: false }));
  handleError(e);
});

// ============ Types ========================================================== //

type BuildOutput = Platform | 'vanilla';
type BuildCommandOptions = { after?: () => void; env?: NodeJS.ProcessEnv };
type TimedResult = { time: number };

// ============ Build Runner =================================================== //

async function build(): Promise<void> {
  const start = performance.now();
  prepareBuild();

  write(`${bold('stores')}\n`);
  const spin = spinner(' exports · types · vanilla · web · native');
  write('\n');

  const [exports, types, vanilla, web, native] = await Promise.all([
    generateExports(),
    buildTypes(),
    buildOutput('vanilla'),
    buildOutput('web'),
    buildOutput('native'),
  ]).finally(spin.stop);

  write(
    timedRow('exports', exports.time),
    timedRow('types', types.time),
    timedRow('vanilla', vanilla.time, bundleSummary('vanilla')),
    timedRow('web', web.time, bundleSummary('web')),
    timedRow('native', native.time, bundleSummary('native')),
    summary('build', { time: performance.now() - start })
  );
}

// ============ Build Helpers ================================================== //

async function buildTypes(): Promise<TimedResult> {
  return timed(async () => {
    await Promise.all([
      runCommand('tsc -p tsconfig.build.json --emitDeclarationOnly', { after: removeDisabledPluginTypes }),
      runCommand('tsc -p tsconfig.build.vanilla.json --emitDeclarationOnly', { after: normalizeVanillaDeclarations }),
    ]);
  });
}

async function timed(action: () => Promise<void>): Promise<TimedResult> {
  const start = performance.now();
  await action();
  return { time: performance.now() - start };
}

async function runCommand(command: string, options?: BuildCommandOptions): Promise<void> {
  await execAsync(command, { cwd: root, env: options?.env });
  options?.after?.();
}

function buildOutput(output: BuildOutput): Promise<TimedResult> {
  return timed(() => runCommand(`tsup --config tsup.config.ts --out-dir dist/${output} --no-clean`, { env: productionEnv(output) }));
}

function generateExports(): Promise<TimedResult> {
  return timed(() => runCommand('tsx --tsconfig scripts/tsconfig.json scripts/generate-exports.ts'));
}

function productionEnv(output: BuildOutput): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    ...(output === 'native' ? { BUILD_TARGET: 'native' } : undefined),
    ...(output === 'vanilla' ? { BUILD_MODE: 'vanilla' } : undefined),
  };
}

// ============ Summary Utilities ============================================== //

function bundleSummary(output: BuildOutput): string {
  const dir = join(root, 'dist', output);
  const totalSize = mjsSize(dir);
  const entries = output === 'vanilla' ? {} : pluginBuildEntries(output);

  let pluginsSize = 0;
  for (const entry of Object.keys(entries)) pluginsSize += statSync(join(dir, `${entry}.mjs`)).size;

  const coreSize = totalSize - pluginsSize;
  return `${formatSize(totalSize)} · core ${formatSize(coreSize)} · plugins ${formatSize(pluginsSize)}`;
}

function mjsSize(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return path.endsWith('.mjs') ? stat.size : 0;

  const entries = readdirSync(path);
  let size = 0;

  for (let i = 0; i < entries.length; i++) size += mjsSize(join(path, entries[i]));
  return size;
}

// ============ File Utilities ================================================= //

function copyFilesFromRoot(files: string[]): void {
  for (const file of files) copyFileSync(join(root, '../..', file), join(root, file));
}

function prepareBuild(): void {
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  copyFilesFromRoot(['LICENSE', 'README.md']);
}

function normalizeVanillaDeclarations(dir: string = join(root, 'dist/vanilla')): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      normalizeVanillaDeclarations(entryPath);
    } else if (entry.name.endsWith('.vanilla.d.ts')) {
      copyFileSync(entryPath, join(dir, entry.name.replace(/\.vanilla\.d\.ts$/, '.d.ts')));
    }
  }
}

function removeDisabledPluginTypes(): void {
  for (let i = 0; i < disabledPluginTypeRoots.length; i++) {
    rmSync(join(root, disabledPluginTypeRoots[i]), { recursive: true, force: true });
  }
}
