import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const hasArgs = args.length > 0;
const vitestPaths = ['src/hooks', 'src/plugins', 'src/queryStore/vitest'];
const hasVitestPathArg = args.some(arg => vitestPaths.some(path => arg.includes(path)));

const jestBase = [
  'exec',
  'jest',
  '--detectOpenHandles',
  '--forceExit',
  '--testPathIgnorePatterns=src/hooks',
  '--testPathIgnorePatterns=src/plugins',
  '--testPathIgnorePatterns=src/queryStore/vitest',
];

const vitestBase = ['exec', 'vitest', 'run'];

if (!hasArgs) {
  const jestExitCode = run('pnpm', jestBase);
  if (jestExitCode !== 0) process.exit(jestExitCode);
  const vitestExitCode = run('pnpm', [...vitestBase, ...vitestPaths]);
  process.exit(vitestExitCode);
}

if (hasVitestPathArg) {
  process.exit(run('pnpm', [...vitestBase, ...args]));
}

process.exit(run('pnpm', [...jestBase, ...args]));

function run(command: string, commandArgs: readonly string[]): number {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
