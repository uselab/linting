import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { builders, generateCode, parseModule, type ProxifiedModule } from 'magicast';
import { getConfigFromVariableDeclaration, getDefaultExportOptions } from 'magicast/helpers';
import { ALIASES } from './tsconfig';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];

/** Vite aliases (without `/*`) mapped to their folder, e.g. `@app` → `src/app`. */
const VITE_ALIASES: [string, string][] = Object.entries(ALIASES).map(([alias, folder]) => [
  alias.replace('/*', ''),
  folder,
]);

const aliasValue = (folder: string): string =>
  `fileURLToPath(new URL('./${folder}', import.meta.url))`;

export type ViteConfigInfo = { file: string; absolutePath: string; text: string };

/** Returns the first Vite config file of the project. */
export const findViteConfig = (projectDir: string): ViteConfigInfo | undefined => {
  const file = VITE_CONFIGS.find((name) => existsSync(path.join(projectDir, name)));
  if (!file) {
    return undefined;
  }
  const absolutePath = path.join(projectDir, file);
  return { file, absolutePath, text: readFileSync(absolutePath, 'utf8') };
};

export type ViteAliasReport = {
  /** False when the config can't be edited automatically (e.g. a function config). */
  supported: boolean;
  missing: string[];
};

type ProxyObject = Record<string, unknown>;

type Parsed = { mod: ProxifiedModule; options: ProxyObject; commit: () => void };

type ConfigOptions = { options: unknown; commit: () => void };

/** True for a magicast proxy of an object literal (not an array, function or identifier). */
const isObject = (value: unknown): value is ProxyObject =>
  // The proxy's `has` trap hides `$type`, so `'$type' in value` can't be used.
  value instanceof Object && !Array.isArray(value) && Reflect.get(value, '$type') === 'object';

/**
 * `getConfigFromVariableDeclaration` returns a re-parsed copy of the config, so `commit` writes the
 * edited copy back into the variable declaration.
 */
const variableConfigOptions = (mod: ProxifiedModule): ConfigOptions => {
  const { declaration, config } = getConfigFromVariableDeclaration(mod);
  const commit = (): void => {
    const ast = config?.$ast;
    if (ast?.type !== 'ObjectExpression') {
      return;
    }
    const { init } = declaration;
    const target = init?.type === 'TSSatisfiesExpression' ? init.expression : init;
    if (target?.type === 'CallExpression') {
      target.arguments[0] = ast;
    } else if (init?.type === 'TSSatisfiesExpression') {
      init.expression = ast;
    } else {
      declaration.init = ast;
    }
  };
  return { options: config, commit };
};

/**
 * Returns the config object of `export default {...}` / `defineConfig({...})`, also when exported
 * through a variable (`const config = defineConfig({...}); export default config`).
 */
const configOptions = (mod: ProxifiedModule): ConfigOptions => {
  const options: unknown = getDefaultExportOptions(mod);
  return options instanceof Object && Reflect.get(options, '$type') === 'identifier'
    ? variableConfigOptions(mod)
    : { options, commit: () => {} };
};

/**
 * Parses a Vite config whose default export is an object or `defineConfig({ ... })` (directly or
 * via a variable). Returns undefined otherwise.
 */
const parseConfig = (text: string): Parsed | undefined => {
  try {
    const mod = parseModule(text);
    const { options, commit } = configOptions(mod);
    return isObject(options) ? { mod, options, commit } : undefined;
  } catch {
    return undefined;
  }
};

/** Like `parseConfig`, with `resolve` and `resolve.alias` (if present) being plain objects. */
const parseViteConfig = (text: string): Parsed | undefined => {
  const parsed = parseConfig(text);
  const resolve = parsed?.options.resolve;
  const supported =
    resolve === undefined ||
    (isObject(resolve) && (resolve.alias === undefined || isObject(resolve.alias)));
  return supported ? parsed : undefined;
};

/** Lists the `@app` / `@features` / `@support` aliases missing from `resolve.alias`. */
export const checkViteAliases = (text: string): ViteAliasReport => {
  const parsed = parseViteConfig(text);
  if (!parsed) {
    const missing = VITE_ALIASES.map(([alias]) => alias).filter(
      (alias) => !text.includes(`'${alias}'`) && !text.includes(`"${alias}"`),
    );
    return { supported: false, missing };
  }
  const { resolve } = parsed.options;
  const alias = isObject(resolve) && isObject(resolve.alias) ? resolve.alias : {};
  return {
    supported: true,
    missing: VITE_ALIASES.map(([name]) => name).filter((name) => !(name in alias)),
  };
};

/**
 * Adds the missing aliases to `resolve.alias` (merging with existing entries) and imports
 * `fileURLToPath` / `URL` from `node:url`. Returns undefined when the config shape isn't supported.
 */
export const addViteAliases = (text: string): string | undefined => {
  const parsed = parseViteConfig(text);
  if (!parsed) {
    return undefined;
  }
  const { mod, options, commit } = parsed;
  if (options.resolve === undefined) {
    options.resolve = {};
  }
  const { resolve } = options;
  if (!isObject(resolve)) {
    return undefined;
  }
  if (resolve.alias === undefined) {
    resolve.alias = {};
  }
  const { alias } = resolve;
  if (!isObject(alias)) {
    return undefined;
  }
  for (const [name, folder] of VITE_ALIASES) {
    if (!(name in alias)) {
      alias[name] = builders.raw(aliasValue(folder));
    }
  }
  for (const imported of ['fileURLToPath', 'URL']) {
    if (!(imported in mod.imports)) {
      mod.imports.$add({ from: 'node:url', imported });
    }
  }
  commit();
  return generateCode(mod).code;
};

const IMPORT_SOURCE = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

const isNodeBuiltin = (source: string): boolean =>
  source.startsWith('node:') || builtinModules.includes(source.split('/')[0] ?? '');

/** True for a TypeScript Vite config that imports a Node builtin (and so needs `@types/node`). */
export const viteConfigNeedsNodeTypes = (file: string, text: string): boolean =>
  /\.m?ts$/.test(file) &&
  [...text.matchAll(IMPORT_SOURCE)].some(([, source]) => isNodeBuiltin(source ?? ''));

/** Snippet with the expected `resolve.alias` for manual setup. */
export const viteAliasSnippet = (): string =>
  [
    "import { fileURLToPath, URL } from 'node:url';",
    '',
    '// in defineConfig({ ... }):',
    'resolve: {',
    '  alias: {',
    ...VITE_ALIASES.map(([alias, folder]) => `    '${alias}': ${aliasValue(folder)},`),
    '  },',
    '},',
  ].join('\n');

export const VITE_CHECKER = 'vite-plugin-checker';

export type ViteCheckerOptions = {
  /** Use `vue-tsc` (for `.vue` files) instead of `tsc`. */
  vue: boolean;
  /** tsconfig to type-check; omitted from the options for the default `tsconfig.json`. */
  tsconfig?: string;
};

/**
 * The `checker({ ... })` options: types (tsc / vue-tsc) and ESLint in the dev overlay, and errors
 * failing `vite build` (`enableBuild` is set explicitly, so the config shows it).
 */
const checkerOptions = ({ vue, tsconfig }: ViteCheckerOptions): Record<string, unknown> => ({
  [vue ? 'vueTsc' : 'typescript']:
    tsconfig === undefined || tsconfig === 'tsconfig.json' ? true : { tsconfigPath: tsconfig },
  eslint: { lintCommand: 'eslint .', useFlatConfig: true },
  enableBuild: true,
});

/** True when the Vite config already uses vite-plugin-checker. */
export const hasViteChecker = (text: string): boolean =>
  text.includes(`'${VITE_CHECKER}'`) || text.includes(`"${VITE_CHECKER}"`);

/**
 * Adds `checker({ ... })` to `plugins` and imports it from vite-plugin-checker. Returns undefined
 * when the config shape isn't supported (e.g. a function config or a non-array `plugins`).
 */
export const addViteChecker = (text: string, options: ViteCheckerOptions): string | undefined => {
  const parsed = parseConfig(text);
  if (!parsed) {
    return undefined;
  }
  const { mod, options: config, commit } = parsed;
  if (config.plugins === undefined) {
    config.plugins = [];
  }
  const { plugins } = config;
  if (!Array.isArray(plugins)) {
    return undefined;
  }
  plugins.push(builders.functionCall('checker', checkerOptions(options)));
  mod.imports.$add({ from: VITE_CHECKER, imported: 'default', local: 'checker' });
  commit();
  return generateCode(mod).code;
};

/** Snippet with the vite-plugin-checker setup for manual setup. */
export const viteCheckerSnippet = (options: ViteCheckerOptions): string =>
  [
    `import checker from '${VITE_CHECKER}';`,
    '',
    '// in plugins: [ ... ]:',
    `checker(${JSON.stringify(checkerOptions(options), undefined, 2)
      .replaceAll(/"(\w+)":/g, '$1:')
      .replaceAll('"', "'")}),`,
  ].join('\n');
