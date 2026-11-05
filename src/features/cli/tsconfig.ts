import { createRequire } from 'node:module';
import path from 'node:path';
import {
  coversDir,
  isSolution,
  normalizeSrcDir,
  readTsconfig,
  referencePath,
  toPosix,
  type TsconfigInfo,
} from '../../support/source-tsconfig';
import { applyJsonChanges, removeArrayItems } from './json-edit';

export {
  findSourceTsconfig,
  findSourceTsconfigs,
  type TsconfigInfo,
} from '../../support/source-tsconfig';

/** Folders (inside a src dir) of the path aliases expected by the aliases preset. */
const ALIAS_FOLDERS: Readonly<Record<string, string>> = {
  '@app/*': 'app',
  '@features/*': 'features',
  '@support/*': 'support',
};

/** Path aliases for a src dir, e.g. `{ '@app/*': 'src/app', ... }`. */
export const aliasesFor = (srcDir = 'src'): Record<string, string> =>
  Object.fromEntries(
    Object.entries(ALIAS_FOLDERS).map(([alias, folder]) => [
      alias,
      `${normalizeSrcDir(srcDir)}/${folder}`,
    ]),
  );

/** Path aliases expected by the `no-restricted-imports` rule of the aliases preset. */
export const ALIASES: Readonly<Record<string, string>> = aliasesFor();

export type AliasStatus = 'ok' | 'missing' | 'conflict';

export type AliasCheck = {
  alias: string;
  expected: string;
  status: AliasStatus;
  actual?: string[];
};

export type AliasReport = {
  checks: AliasCheck[];
  /** False when `paths` is inherited through `extends`; adding paths would then hide the inherited ones. */
  editable: boolean;
};

type RawTsconfig = TsconfigInfo['config'];

const coversSrc = (projectDir: string, info: TsconfigInfo): boolean =>
  coversDir(info, path.join(projectDir, 'src'));

type ResolvedOptions = {
  paths?: Record<string, string[]>;
  pathsDefinedIn?: string;
  baseUrl?: string;
  types?: string[];
};

const extendedPaths = (configDir: string, extendsValue: RawTsconfig['extends']): string[] =>
  [extendsValue ?? []]
    .flat()
    .filter((entry) => entry.startsWith('.'))
    .map((entry) => path.resolve(configDir, entry.endsWith('.json') ? entry : `${entry}.json`));

/** Resolves `paths` and `baseUrl` through relative `extends` chains (package extends are skipped). */
const resolveOptions = (info: TsconfigInfo, depth = 0): ResolvedOptions => {
  const configDir = path.dirname(info.absolutePath);
  const own = info.config.compilerOptions ?? {};
  const parents = depth > 5 ? [] : extendedPaths(configDir, info.config.extends);
  const inherited = parents
    .map((parentPath) => readTsconfig(configDir, parentPath))
    .filter((parent): parent is TsconfigInfo => parent !== undefined)
    .map((parent) => resolveOptions(parent, depth + 1))
    .reduce<ResolvedOptions>((result, options) => ({ ...result, ...options }), {});
  return {
    paths: own.paths ?? inherited.paths,
    pathsDefinedIn: own.paths ? info.absolutePath : inherited.pathsDefinedIn,
    baseUrl: own.baseUrl === undefined ? inherited.baseUrl : path.resolve(configDir, own.baseUrl),
    types: own.types ?? inherited.types,
  };
};

const normalizeTarget = (target: string): string => toPosix(target).replace(/^\.\//, '');

const expectedTarget = (baseDir: string, projectDir: string, folder: string): string => {
  const relative = toPosix(path.relative(baseDir, path.join(projectDir, folder)));
  return `${relative.startsWith('..') ? relative : `./${relative}`}/*`;
};

/** Checks that the tsconfig maps `@app/*`, `@features/*` and `@support/*` to the src dir's folders. */
export const checkAliases = (
  projectDir: string,
  info: TsconfigInfo,
  srcDir = 'src',
): AliasReport => {
  const resolved = resolveOptions(info);
  const definedIn = resolved.pathsDefinedIn ?? info.absolutePath;
  const baseDir = resolved.baseUrl ?? path.dirname(definedIn);
  const checks = Object.entries(aliasesFor(srcDir)).map(([alias, folder]): AliasCheck => {
    const expected = expectedTarget(baseDir, projectDir, folder);
    const actual = resolved.paths?.[alias];
    if (!actual) {
      return { alias, expected, status: 'missing' };
    }
    const matches = actual.some((target) => normalizeTarget(target) === normalizeTarget(expected));
    return { alias, expected, actual, status: matches ? 'ok' : 'conflict' };
  });
  return { checks, editable: definedIn === info.absolutePath };
};

/** Adds the missing aliases to `compilerOptions.paths`, preserving comments and formatting. */
export const addMissingAliases = (text: string, checks: AliasCheck[]): string =>
  applyJsonChanges(
    text,
    checks
      .filter((check) => check.status === 'missing')
      .map((check) => ({
        path: ['compilerOptions', 'paths', check.alias],
        value: [check.expected],
      })),
  );

/** Snippet with the expected `paths` for manual setup. */
export const pathsSnippet = (srcDir = 'src'): string =>
  JSON.stringify(
    {
      compilerOptions: {
        paths: Object.fromEntries(
          Object.entries(aliasesFor(srcDir)).map(([alias, folder]) => [alias, [`./${folder}/*`]]),
        ),
      },
    },
    undefined,
    2,
  );

export type ImplicitAnyStatus = 'disallowed' | 'allowed' | 'unknown';

/** Resolves an `extends` entry: relative paths, or packages (e.g. `@vue/tsconfig/tsconfig.dom.json`). */
const resolveExtends = (configDir: string, entry: string): string | undefined => {
  if (entry.startsWith('.') || path.isAbsolute(entry)) {
    const resolved = path.resolve(configDir, entry);
    return resolved.endsWith('.json') ? resolved : `${resolved}.json`;
  }
  const require = createRequire(path.join(configDir, 'noop.js'));
  const candidates = entry.endsWith('.json')
    ? [entry]
    : [entry, `${entry}.json`, `${entry}/tsconfig.json`];
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
};

type ImplicitAnyOption = 'noImplicitAny' | 'strict';

type OptionLookup = { projectDir: string; option: ImplicitAnyOption };

/**
 * The option's value from the config or its `extends` (later entries win); `unresolved` when an
 * `extends` that might set it can't be read.
 */
const inheritedOption = (
  lookup: OptionLookup,
  info: TsconfigInfo,
  depth = 0,
): boolean | undefined | 'unresolved' => {
  const own = info.config.compilerOptions?.[lookup.option];
  if (own !== undefined) {
    return own;
  }
  if (depth > 5) {
    return 'unresolved';
  }
  const configDir = path.dirname(info.absolutePath);
  for (const entry of [info.config.extends ?? []].flat().reverse()) {
    const resolved = resolveExtends(configDir, entry);
    const parent = resolved === undefined ? undefined : readTsconfig(lookup.projectDir, resolved);
    const value = parent ? inheritedOption(lookup, parent, depth + 1) : 'unresolved';
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

/**
 * Whether implicit `any` is disallowed, as TypeScript computes it: the (inherited) `noImplicitAny`,
 * else the (inherited) `strict`. `unknown` when an `extends` can't be resolved.
 */
export const checkImplicitAny = (projectDir: string, info: TsconfigInfo): ImplicitAnyStatus => {
  const value =
    inheritedOption({ projectDir, option: 'noImplicitAny' }, info) ??
    inheritedOption({ projectDir, option: 'strict' }, info);
  if (value === 'unresolved') {
    return 'unknown';
  }
  return value ? 'disallowed' : 'allowed';
};

/** Sets `compilerOptions.noImplicitAny` to true, preserving comments and formatting. */
export const disallowImplicitAny = (text: string): string =>
  applyJsonChanges(text, [{ path: ['compilerOptions', 'noImplicitAny'], value: true }]);

export const NODE_TSCONFIG = 'tsconfig.node.json';

export type TsconfigWrite = { file: string; absolutePath: string; text: string };

export type NodeTsconfigResult =
  /** Not in any tsconfig, or its tsconfig already loads the Node types. */
  | { status: 'unchanged' }
  /** Only matched by a glob/directory include, so it can't be moved out automatically. */
  | { status: 'manual'; file: string }
  | { status: 'updated'; writes: TsconfigWrite[]; split: boolean };

type Coverage = { kind: 'explicit' | 'glob'; field?: 'include' | 'files'; indexes: number[] };

const isGlob = (entry: string): boolean => /[*?]/.test(entry);

const isWithin = (dir: string, file: string): boolean =>
  file.startsWith(`${dir}${path.sep}`) || path.dirname(file) === dir;

/** Whether an `include` glob or directory entry may match the file (approximation). */
const globMatches = (configDir: string, entry: string, file: string): boolean => {
  if (!isGlob(entry)) {
    // A directory entry includes everything below it.
    return path.extname(entry) === '' && isWithin(path.resolve(configDir, entry), file);
  }
  const segments = toPosix(entry).split('/');
  const wildcard = segments.findIndex(isGlob);
  const prefixDir = path.resolve(configDir, ...segments.slice(0, wildcard));
  const rest = segments.slice(wildcard).join('/');
  return rest.includes('**') ? isWithin(prefixDir, file) : path.dirname(file) === prefixDir;
};

const explicitIndexes = (
  configDir: string,
  entries: string[] | undefined,
  file: string,
): number[] =>
  (entries ?? []).flatMap((entry, index) =>
    !isGlob(entry) && path.resolve(configDir, entry) === file ? [index] : [],
  );

const coverageOf = (info: TsconfigInfo, file: string): Coverage | undefined => {
  const configDir = path.dirname(info.absolutePath);
  const { include, files } = info.config;
  for (const field of ['files', 'include'] as const) {
    const indexes = explicitIndexes(configDir, info.config[field], file);
    if (indexes.length > 0) {
      return { kind: 'explicit', field, indexes };
    }
  }
  // Without `include` and `files`, TypeScript includes `**/*`.
  const globs = include ?? (files === undefined ? ['**/*'] : []);
  return globs.some((entry) => globMatches(configDir, entry, file))
    ? { kind: 'glob', indexes: [] }
    : undefined;
};

const rootTsconfig = (projectDir: string): TsconfigInfo | undefined =>
  readTsconfig(projectDir, path.join(projectDir, 'tsconfig.json')) ??
  readTsconfig(projectDir, path.join(projectDir, 'tsconfig.app.json'));

const referencedConfigs = (projectDir: string, info: TsconfigInfo): TsconfigInfo[] =>
  (info.config.references ?? [])
    .map((reference) =>
      readTsconfig(projectDir, referencePath(path.dirname(info.absolutePath), reference.path)),
    )
    .filter((referenced): referenced is TsconfigInfo => referenced !== undefined);

/**
 * Adds `"node"` to the (own or inherited) `types`, or sets `"types": ["node"]` when there are none
 * (TypeScript 6 no longer loads `@types/*` by default); returns undefined if not needed.
 */
const withNodeTypes = (info: TsconfigInfo, text: string): string | undefined => {
  const types = resolveOptions(info).types ?? [];
  return types.includes('node') || types.includes('*')
    ? undefined
    : applyJsonChanges(text, [{ path: ['compilerOptions', 'types'], value: [...types, 'node'] }]);
};

const relativeEntry = (fromDir: string, file: string): string =>
  toPosix(path.relative(fromDir, file));

const newNodeTsconfig = (entry: string): string =>
  [
    '{',
    '  "compilerOptions": {',
    '    "target": "ES2023",',
    '    "lib": ["ES2023"],',
    '    "module": "ESNext",',
    '    "moduleResolution": "Bundler",',
    '    "types": ["node"],',
    '    "strict": true,',
    '    "skipLibCheck": true,',
    '    "isolatedModules": true,',
    '    "noEmit": true',
    '  },',
    `  "include": [${JSON.stringify(entry)}]`,
    '}',
    '',
  ].join('\n');

/** Content of `tsconfig.node.json`: a new one, or the existing one including the file. */
const nodeTsconfigText = (projectDir: string, file: string): string => {
  const nodePath = path.join(projectDir, NODE_TSCONFIG);
  const existing = readTsconfig(projectDir, nodePath);
  if (!existing) {
    return newNodeTsconfig(relativeEntry(projectDir, file));
  }
  let { text } = existing;
  if (coverageOf(existing, file) === undefined) {
    const entry = relativeEntry(path.dirname(nodePath), file);
    text = applyJsonChanges(
      text,
      existing.config.include === undefined
        ? [{ path: ['include'], value: [entry], append: true }]
        : [{ path: ['include', -1], value: entry }],
    );
  }
  return withNodeTypes(existing, text) ?? text;
};

const removeEntries = (text: string, coverage: Coverage): string =>
  removeArrayItems(text, [coverage.field ?? 'include'], coverage.indexes);

/** Adds a reference to `tsconfig.node.json` to a solution-style root (not to configs with files). */
const withNodeReference = (root: TsconfigInfo, text: string, nodePath: string): string => {
  const rootDir = path.dirname(root.absolutePath);
  const references = root.config.references ?? [];
  if (references.some((reference) => referencePath(rootDir, reference.path) === nodePath)) {
    return text;
  }
  const value = { path: `./${toPosix(path.relative(rootDir, nodePath))}` };
  return applyJsonChanges(
    text,
    root.config.references === undefined
      ? [{ path: ['references'], value: [value], append: true }]
      : [{ path: ['references', -1], value }],
  );
};

const toWrite = (projectDir: string, absolutePath: string, text: string): TsconfigWrite => ({
  file: toPosix(path.relative(projectDir, absolutePath)),
  absolutePath,
  text,
});

/**
 * Makes the Node types available to a TypeScript Vite config. A config that only covers it gets
 * `"node"` in its `types`; a config that also covers `src` (browser code) hands the file
 * over to a separate `tsconfig.node.json`, like the Vite templates.
 */
export const setupNodeTsconfig = (projectDir: string, viteConfig: string): NodeTsconfigResult => {
  const file = path.join(projectDir, viteConfig);
  const root = rootTsconfig(projectDir);
  if (!root) {
    return { status: 'unchanged' };
  }
  const candidates = [
    ...(isSolution(root.config) ? [] : [root]),
    ...referencedConfigs(projectDir, root),
  ];
  const covered = candidates.map((info) => ({ info, coverage: coverageOf(info, file) }));
  const owner = covered.find(({ coverage }) => coverage?.kind === 'explicit');
  if (!owner?.coverage) {
    const glob = covered.find(({ coverage }) => coverage?.kind === 'glob');
    return glob ? { status: 'manual', file: glob.info.file } : { status: 'unchanged' };
  }
  const { info, coverage } = owner;
  if (!coversSrc(projectDir, info)) {
    const text = withNodeTypes(info, info.text);
    return text === undefined
      ? { status: 'unchanged' }
      : { status: 'updated', split: false, writes: [toWrite(projectDir, info.absolutePath, text)] };
  }
  const nodePath = path.join(projectDir, NODE_TSCONFIG);
  if (nodePath === info.absolutePath) {
    return { status: 'manual', file: info.file };
  }
  const texts = new Map<string, string>([
    [nodePath, nodeTsconfigText(projectDir, file)],
    [info.absolutePath, removeEntries(info.text, coverage)],
  ]);
  if (isSolution(root.config)) {
    texts.set(root.absolutePath, withNodeReference(root, root.text, nodePath));
  }
  return {
    status: 'updated',
    split: true,
    writes: [...texts].map(([absolutePath, text]) => toWrite(projectDir, absolutePath, text)),
  };
};

export type TypecheckTarget =
  /** Solution-style root: `tsc -b` checks all referenced projects. */
  | { build: true }
  /** tsconfig files to check one by one with `--noEmit`. */
  | { build: false; projects: string[] };

/**
 * What the `typecheck` script should check: the referenced projects of a solution-style root, or
 * the root tsconfig plus a separate `tsconfig.node.json`. Undefined without a tsconfig.
 */
export const typecheckTarget = (projectDir: string): TypecheckTarget | undefined => {
  const root = rootTsconfig(projectDir);
  if (!root) {
    return undefined;
  }
  if (isSolution(root.config)) {
    return { build: true };
  }
  const node = readTsconfig(projectDir, path.join(projectDir, NODE_TSCONFIG));
  const extra = node && node.absolutePath !== root.absolutePath ? [node.file] : [];
  return { build: false, projects: [root.file, ...extra] };
};
