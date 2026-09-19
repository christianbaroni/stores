import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type NormalizedFormat, type TsdownPlugin, type UserConfig } from 'tsdown';
import { pluginBuildEntries, pluginDeclarationEntries, type Platform } from './build/plugins.ts';

// ============ Constants ====================================================== //

const root = path.dirname(fileURLToPath(import.meta.url));
const buildTypes = process.env.STORES_TSDOWN_CONFIG === 'types';
const isProduction = process.env.NODE_ENV === 'production';
const mode = process.env.BUILD_MODE === 'vanilla' ? 'vanilla' : 'react';
const platform: Platform = mode === 'vanilla' || process.env.BUILD_TARGET !== 'native' ? 'web' : 'native';
const buildInternalRuntime = mode === 'react' && platform === 'web';

const internalRuntimeDir = path.resolve(root, 'src/internal');
const runtimeSource = path.resolve(root, 'src/internal/runtime.ts');

// ============ Config ========================================================= //

export default buildTypes ? defineConfig(declarationConfigs()) : defineConfig(bundleConfig());

function bundleConfig(): UserConfig {
  return {
    clean: true,
    dts: false,
    entry:
      mode === 'vanilla'
        ? { index: 'src/index.vanilla.ts' }
        : {
            index: 'src/index.ts',
            ...pluginBuildEntries(platform),
            ...(buildInternalRuntime ? { 'internal/runtime': 'src/internal/runtime.ts' } : undefined),
          },
    deps: { neverBundle: ['react', 'react-native', 'react-native-mmkv'] },
    env: { NODE_ENV: isProduction ? 'production' : 'development' },
    fixedExtension: false,
    format: ['esm', 'cjs'],
    logLevel: 'silent',
    minify: isProduction ? { compress: { dropDebugger: true }, codegen: { legalComments: 'none' } } : false,
    outputOptions: isProduction ? { comments: { legal: false } } : undefined,
    report: false,
    sourcemap: !isProduction,
    target: 'es2020',
    treeshake: true,

    inputOptions(options, format) {
      const conditions = mode === 'vanilla' ? ['vanilla', 'default'] : platform === 'native' ? ['react-native', 'default'] : undefined;
      if (conditions) options.resolve = { ...options.resolve, conditionNames: conditions };
      if (platform === 'web') options.plugins = [options.plugins, externalizeInternalRuntimeImports(format)];
    },
  };
}

function declarationConfigs(): UserConfig[] {
  return [
    declarationConfig('src/index.ts', 'dist', 'tsconfig.build.dts.json'),
    declarationConfig('src/index.vanilla.ts', 'dist/vanilla', 'tsconfig.build.vanilla.dts.json'),
    ...pluginDeclarationEntries().map(({ entry, outDir }) => declarationConfig(entry, outDir, 'tsconfig.build.dts.json')),
  ];
}

function declarationConfig(entry: string, outDir: string, tsconfig: string): UserConfig {
  return {
    clean: false,
    dts: { compilerOptions: { isolatedDeclarations: true }, enabled: true, emitDtsOnly: true },
    entry,
    format: 'esm',
    logLevel: 'silent',
    outDir,
    outExtensions: () => ({ dts: '.d.ts' }),
    report: false,
    target: 'es2020',
    tsconfig,
  };
}

// ============ Utilities ====================================================== //

function externalizeInternalRuntimeImports(format: NormalizedFormat): TsdownPlugin {
  const extension = format === 'es' ? '.mjs' : '.js';
  const runtimeImport = mode === 'vanilla' ? `../web/internal/runtime${extension}` : `./internal/runtime${extension}`;

  return {
    name: 'externalize-internal-runtime-imports',
    resolveId(source, importer, options) {
      if (importer === undefined || options.isEntry || !source.startsWith('.')) return undefined;

      const resolveDir = path.dirname(importer);
      const request = source.endsWith('.ts') ? source : `${source}.ts`;
      const resolvedPath = path.resolve(resolveDir, request);
      if (resolvedPath === runtimeSource) return { id: runtimeImport, external: true };

      if (!isInternalRuntimePath(resolveDir) && isInternalRuntimePath(resolvedPath)) {
        this.error(`Web entries must import ${path.relative(resolveDir, runtimeSource)} instead of ${source}.`);
      }
    },
  };
}

function isInternalRuntimePath(filePath: string): boolean {
  const relativePath = path.relative(internalRuntimeDir, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
