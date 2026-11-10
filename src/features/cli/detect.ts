import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_QUERY_LIBRARY,
  QUERY_LIBRARIES,
  queryLibrary,
  type QueryFramework,
  type QueryLibrary,
  type QueryLibraryId,
} from '../../support/query-libraries';
import { DEFAULT_TEST_FILES, PRESET_ORDER, type PresetId, type ProjectType } from './generate';

export type DetectablePackageJson = {
  bin?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type Detection = {
  /** Detected presets, without `browser` / `node`: those follow from the project type. */
  presets: PresetId[];
  /** Why each preset was selected, in preset order. */
  reasons: Partial<Record<PresetId, string>>;
  projectType: ProjectType;
  /** Why the project type was detected. */
  projectTypeReason: string;
  /** The query library of the detected framework; undefined without Vue or React. */
  queryLibrary?: QueryLibraryId;
};

const VUE_PACKAGES = ['vue', 'nuxt'];
const REACT_PACKAGES = ['react', 'react-dom', 'next'];
const BROWSER_PACKAGES = [...VUE_PACKAGES, ...REACT_PACKAGES, 'svelte', 'vite'];
const NODE_PACKAGES = ['express', 'fastify', 'koa', 'hono'];
const NODE_SCOPES = ['@nestjs/'];
/** Bundlers / frameworks that resolve the path aliases (some after `init` adds them). */
const ALIAS_PACKAGES = ['vite', 'nuxt', 'next', 'webpack', '@rsbuild/core', 'parcel'];

const hasTypeScriptSources = (projectDir: string): boolean => {
  const src = path.join(projectDir, 'src');
  if (!existsSync(src)) {
    return false;
  }
  return readdirSync(src, { recursive: true, encoding: 'utf8' }).some(
    (file) => /\.(?:ts|tsx|mts|cts)$/.test(file) && !file.endsWith('.d.ts'),
  );
};

const firstOf = (declared: string[], names: string[]): string | undefined =>
  names.find((name) => declared.includes(name));

/**
 * Extensions of the languages Prettier formats out of the box (plus Vue), in the order they are
 * reported: the main source types first, then the rest.
 */
const PRETTIER_EXTENSIONS = [
  '.ts',
  '.js',
  '.vue',
  '.jsx',
  '.tsx',
  '.json',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.jsonc',
  '.json5',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.mdx',
  '.yaml',
  '.yml',
  '.graphql',
  '.gql',
  '.hbs',
  '.handlebars',
];

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);

/** Whether a directory is scanned: skips dependencies, build output and dot directories. */
export const isScannedDirectory = (name: string): boolean =>
  !name.startsWith('.') && !SKIPPED_DIRECTORIES.has(name);

/**
 * Extensions of the files Prettier can format, skipping dependencies, build output and dot
 * directories. Stops early once the highest-priority extension is found.
 */
const findPrettierExtensions = (projectDir: string): Set<string> => {
  const found = new Set<string>();
  const queue = [projectDir];
  for (let directory = queue.shift(); directory !== undefined; directory = queue.shift()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && isScannedDirectory(entry.name)) {
        queue.push(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        found.add(path.extname(entry.name).toLowerCase());
      }
    }
    if (found.has(PRETTIER_EXTENSIONS[0] ?? '')) {
      break;
    }
  }
  return found;
};

const prettierReason = (projectDir: string): string | undefined => {
  const found = findPrettierExtensions(projectDir);
  const extension = PRETTIER_EXTENSIONS.find((candidate) => found.has(candidate));
  return extension === undefined ? undefined : `${extension} files found`;
};

const LAYOUT_FOLDERS = ['app', 'features', 'support'];

const hasLayout = (dir: string): boolean =>
  LAYOUT_FOLDERS.some((folder) => existsSync(path.join(dir, folder)));

/**
 * Src folders for the boundaries preset: folders named `src` that contain `app/`, `features/` or
 * `support/` (skipping dependencies, build output and dot directories), as project-relative
 * posix paths. Falls back to `['src']`.
 */
export const detectSrcDirs = (projectDir: string): string[] => {
  const found: string[] = [];
  const queue = [projectDir];
  for (let directory = queue.shift(); directory !== undefined; directory = queue.shift()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory() && isScannedDirectory(entry.name)) {
        if (entry.name === 'src' && hasLayout(child)) {
          found.push(path.relative(projectDir, child).split(path.sep).join('/'));
        } else {
          queue.push(child);
        }
      }
    }
  }
  return found.length > 0 ? found.sort() : ['src'];
};

const TEST_DIRECTORY = /^te?sts?$/;

/**
 * Test file globs: `<folder>/**` for every folder in the project root named `test`, `tests`,
 * `tst` or `tsts`. Falls back to `['test/**']`.
 */
export const detectTestFiles = (projectDir: string): string[] => {
  const found = readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && TEST_DIRECTORY.test(entry.name))
    .map((entry) => `${entry.name}/**`)
    .sort();
  return found.length > 0 ? found : [...DEFAULT_TEST_FILES];
};

/**
 * Drops src folders inside a test location, e.g. `test/fixtures/app/src` for `test/**`. Only
 * folder globs match; file globs such as `**\/*.test.ts` don't. Falls back to `['src']`.
 */
export const excludeTestSrcDirs = (srcDirs: string[], testFiles: readonly string[]): string[] => {
  const globs = testFiles.map((glob) => glob.replace(/^\.\//, ''));
  const kept = srcDirs.filter(
    (srcDir) => !globs.some((glob) => path.posix.matchesGlob(`${srcDir}/file`, glob)),
  );
  return kept.length > 0 ? kept : ['src'];
};

const dependencyReason = (name: string | undefined): string | undefined =>
  name === undefined ? undefined : `${name} dependency`;

/** The query library of a declared framework: an already declared one, else the framework default. */
const detectQueryLibrary = (
  declared: string[],
  frameworks: QueryFramework[],
): QueryLibrary | undefined => {
  const [framework] = frameworks;
  if (framework === undefined) {
    return undefined;
  }
  const own = QUERY_LIBRARIES.filter((library) => library.framework === framework);
  return (
    own.find(({ packages }) => declared.includes(packages[0]?.name ?? '')) ??
    queryLibrary(DEFAULT_QUERY_LIBRARY[framework])
  );
};

const queryReason = (library: QueryLibrary | undefined, declared: string[]): string | undefined => {
  if (library === undefined) {
    return undefined;
  }
  const name = library.packages[0]?.name ?? library.id;
  return declared.includes(name) ? `${name} dependency` : `${library.framework} project → ${name}`;
};

type Signals = {
  projectDir: string;
  declared: string[];
  packageJson: DetectablePackageJson | undefined;
  tsconfigFile: string | undefined;
};

const typescriptReason = ({ projectDir, declared, tsconfigFile }: Signals): string | undefined => {
  if (tsconfigFile) {
    return `${tsconfigFile} found`;
  }
  if (declared.includes('typescript')) {
    return 'typescript dependency';
  }
  return hasTypeScriptSources(projectDir) ? '.ts files in src' : undefined;
};

const browserReason = ({ projectDir, declared }: Signals): string | undefined =>
  dependencyReason(firstOf(declared, BROWSER_PACKAGES)) ??
  (existsSync(path.join(projectDir, 'index.html')) ? 'index.html found' : undefined);

const nodeReason = (signals: Signals): string => {
  const server =
    firstOf(signals.declared, NODE_PACKAGES) ??
    signals.declared.find((name) => NODE_SCOPES.some((scope) => name.startsWith(scope)));
  if (server) {
    return `${server} dependency`;
  }
  if (signals.packageJson?.bin !== undefined) {
    return 'package.json has a "bin" field';
  }
  return 'no browser framework found';
};

/** Preselects presets and the project type based on the project's dependencies and files. */
export const detectPresets = (
  projectDir: string,
  packageJson: DetectablePackageJson | undefined,
  tsconfigFile: string | undefined,
): Detection => {
  const declared = Object.keys({ ...packageJson?.dependencies, ...packageJson?.devDependencies });
  const signals: Signals = { projectDir, declared, packageJson, tsconfigFile };
  const browser = browserReason(signals);
  const frameworks: QueryFramework[] = [
    ...(firstOf(declared, VUE_PACKAGES) ? (['vue'] as const) : []),
    ...(firstOf(declared, REACT_PACKAGES) ? (['react'] as const) : []),
  ];
  const library = detectQueryLibrary(declared, frameworks);
  const found: Partial<Record<PresetId, string>> = {
    javascript: 'always',
    typescript: typescriptReason(signals),
    vue: dependencyReason(firstOf(declared, VUE_PACKAGES)),
    vueA11y: dependencyReason(firstOf(declared, VUE_PACKAGES)),
    react: dependencyReason(firstOf(declared, REACT_PACKAGES)),
    query: queryReason(library, declared),
    aliases: dependencyReason(firstOf(declared, ALIAS_PACKAGES)),
    boundaries: 'always',
    prettier: prettierReason(projectDir),
  };
  const presets = PRESET_ORDER.filter((preset) => found[preset] !== undefined);
  return {
    presets,
    reasons: Object.fromEntries(presets.map((preset) => [preset, found[preset]])),
    projectType: browser === undefined ? 'node' : 'browser',
    projectTypeReason: browser ?? nodeReason(signals),
    queryLibrary: library?.id,
  };
};

/**
 * Default browser globs of a browser project: `<dir>/**` for every folder named `src` that isn't
 * inside another `src` folder or a test location (skipping dependencies, build output and dot
 * directories). Falls back to `['src/**']`.
 */
export const detectBrowserFiles = (projectDir: string, testFiles: readonly string[]): string[] => {
  const found: string[] = [];
  const queue = [projectDir];
  for (let directory = queue.shift(); directory !== undefined; directory = queue.shift()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && isScannedDirectory(entry.name)) {
        const child = path.join(directory, entry.name);
        if (entry.name === 'src') {
          found.push(path.relative(projectDir, child).split(path.sep).join('/'));
        } else {
          queue.push(child);
        }
      }
    }
  }
  const globs = testFiles.map((glob) => glob.replace(/^\.\//, ''));
  const kept = found
    .filter((srcDir) => !globs.some((glob) => path.posix.matchesGlob(`${srcDir}/file`, glob)))
    .sort();
  return kept.length > 0 ? kept.map((srcDir) => `${srcDir}/**`) : ['src/**'];
};
