import type { NoOverlap } from '../src/types/objects';

// ============ Types ========================================================== //

export type Platform = 'web' | 'native';
export type PluginConfig = readonly Platform[] & { subpaths?: readonly PluginSubpath[] };
export type PluginSubpath = string | EntrypointSubpath;

type EntrypointSubpath = { entrypoint: string };
type Plugins = Record<string, PluginConfig>;

// ============ Plugins Config ================================================= //

const platforms: Record<Platform | 'all', readonly Platform[]> = Object.freeze({
  all: ['native', 'web'],
  native: ['native'],
  web: ['web'],
});

export const { disabledPluginTypeRoots, plugins } = definePlugins({ chrome: platforms.web });

// ============ Plugin Selection =============================================== //

function definePlugins<const Production extends Plugins, const Experimental extends Plugins>(
  production: Production,
  experimental?: NoOverlap<Production, Experimental>
): { disabledPluginTypeRoots: readonly string[]; plugins: Plugins } {
  const publishing = isPublishing();
  const disabledPluginTypeRoots = publishing ? Object.keys(experimental ?? {}).map(pluginTypesRoot) : [];
  const plugins = publishing ? production : { ...production, ...experimental };

  return { disabledPluginTypeRoots, plugins };
}

function isPublishing(): boolean {
  const lifecycle = process.env.npm_lifecycle_event;
  return lifecycle === 'prepublishOnly' || lifecycle === 'prepack';
}

// ============ Build Entries ================================================== //

export function pluginBuildEntries(platform: Platform): Record<string, string> {
  const buildEntries: Record<string, string> = {};

  for (const name in plugins) {
    const config = plugins[name];
    if (!config.includes(platform)) continue;

    buildEntries[name] = pluginSourcePath(name);

    const subpaths = config.subpaths;
    if (subpaths === undefined) continue;

    for (let j = 0; j < subpaths.length; j++) {
      const subpath = subpaths[j];
      if (typeof subpath !== 'string') buildEntries[pluginOutputName(name, subpath)] = pluginSourcePath(name, subpath);
    }
  }

  return buildEntries;
}

// ============ Path Utilities ================================================= //

export function pluginOutputPath(name: string, platform: Platform, esm: boolean, subpath?: PluginSubpath): string {
  return `./dist/${platform}/${pluginOutputName(name, subpath)}.${esm ? 'mjs' : 'js'}`;
}

export function pluginTypesPath(name: string, subpath?: PluginSubpath): string {
  if (subpath === undefined || typeof subpath === 'string') return `${pluginTypesRoot(name)}/index.d.ts`;
  return `${pluginTypesRoot(name)}/${subpath.entrypoint}.d.ts`;
}

export function pluginSubpathName(subpath: PluginSubpath): string {
  return typeof subpath === 'string' ? subpath : subpath.entrypoint;
}

function pluginOutputName(name: string, subpath?: PluginSubpath): string {
  return subpath === undefined || typeof subpath === 'string' ? name : `${name}-${subpath.entrypoint}`;
}

function pluginSourcePath(name: string, subpath?: EntrypointSubpath): string {
  return subpath === undefined ? `src/plugins/${name}/index.ts` : `src/plugins/${name}/${subpath.entrypoint}.ts`;
}

function pluginTypesRoot(name: string): string {
  return `./dist/plugins/${name}`;
}
