import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type NormalizedFormat, type TsdownPlugin, type UserConfig } from 'tsdown';
import { pluginBuildEntries, pluginDeclarationEntries, type Platform } from './build/plugins.ts';
import sourcePackage from './src/package.json' with { type: 'json' };

// ============ Types ========================================================== //

type DeclarationCondition = 'default' | 'vanilla';

// ============ Constants ====================================================== //

const root = path.dirname(fileURLToPath(import.meta.url));
const internalRuntimeDir = path.resolve(root, 'src/internal');
const runtimeSource = path.resolve(root, 'src/internal/runtime.ts');

const buildTypes = process.env.STORES_TSDOWN_CONFIG === 'types';
const isProduction = process.env.NODE_ENV === 'production';
const mode = process.env.BUILD_MODE === 'vanilla' ? 'vanilla' : 'react';
const platform: Platform = mode === 'vanilla' || process.env.BUILD_TARGET !== 'native' ? 'web' : 'native';
const buildInternalRuntime = mode === 'react' && platform === 'web';

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
    declarationConfig('src/index.vanilla.ts', 'dist/vanilla', 'tsconfig.build.vanilla.dts.json', 'vanilla'),
    ...pluginDeclarationEntries().map(({ entry, outDir }) => declarationConfig(entry, outDir, 'tsconfig.build.dts.json')),
  ];
}

function declarationConfig(entry: string, outDir: string, tsconfig: string, condition: DeclarationCondition = 'default'): UserConfig {
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

    inputOptions(options) {
      options.plugins = [resolveSourceImports(condition), options.plugins];
    },
  };
}

// ============ Utilities ====================================================== //

function resolveSourceImports(condition: DeclarationCondition): TsdownPlugin {
  const sources: Record<string, Record<string, string>> = sourcePackage.imports;
  const imports = new Map<string, string>();

  source: for (const id in sources) {
    for (const key in sources[id]) {
      if (key !== 'default' && key !== condition) continue;
      imports.set(id, path.resolve(root, 'src', sources[id][key]));
      continue source;
    }
    throw new Error('No matching source import for ' + id);
  }

  return {
    name: 'resolve-source-imports',
    resolveId: {
      order: 'pre',
      filter: { id: /^#/ },
      handler(id, importer, options) {
        const target = imports.get(id);
        if (target) return this.resolve(target, importer, options);
      },
    },
  };
}

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
