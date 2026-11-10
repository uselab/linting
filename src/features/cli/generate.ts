import { DEFAULT_IGNORES } from '../../support/ignores';
import { ROOT_TOOLING_FILES, TEST_FILES } from '../../support/shared';

export type PresetId =
  | 'javascript'
  | 'typescript'
  | 'vue'
  | 'vueA11y'
  | 'react'
  | 'browser'
  | 'node'
  | 'aliases'
  | 'boundaries'
  | 'prettier';

/** Order in which presets are spread into the generated config. `prettier` must be last. */
export const PRESET_ORDER: readonly PresetId[] = [
  'javascript',
  'typescript',
  'vue',
  'vueA11y',
  'react',
  'browser',
  'node',
  'aliases',
  'boundaries',
  'prettier',
];

export const DEFAULT_BOUNDARIES_SRC_DIRS = ['src'];

export type BoundariesAnswers = {
  srcDirs?: string[];
  tsconfig?: string | string[];
};

export const DEFAULT_TEST_FILES: readonly string[] = TEST_FILES;

export type JavaScriptAnswers = {
  /** Globs of test files; the default globs when undefined. */
  testFiles?: string[];
};

/**
 * Which files ESLint lints: all files, all except `globs` (opt-out) or only `globs` (opt-in).
 */
export type IgnoresMode = 'all' | 'exclude' | 'only';

export type IgnoresAnswers = {
  mode: IgnoresMode;
  globs: string[];
};

/** A browser project gets browser globals for its browser files and Node globals elsewhere. */
export type ProjectType = 'browser' | 'node';

export type EnvironmentAnswers = {
  type: ProjectType;
  /** Globs of the browser files; only used for a browser project. */
  browserFiles: string[];
};

export type InitAnswers = {
  presets: PresetId[];
  javascript?: JavaScriptAnswers;
  boundaries?: BoundariesAnswers;
  /** Project type; `browser()` / `node()` cover all files when undefined. */
  environment?: EnvironmentAnswers;
  /** Lint scope; all files when undefined. */
  ignores?: IgnoresAnswers;
};

/** The presets of a project type: a browser project also gets Node globals outside its files. */
export const environmentPresets = (type: ProjectType): PresetId[] =>
  type === 'browser' ? ['browser', 'node'] : ['node'];

/** Opt-in prefix: ignore everything, but keep descending into folders so negations can match. */
export const IGNORE_EVERYTHING = ['**/*', '!**/*/'];

/** Root tooling files (eslint.config.ts, vite.config.ts, ...), kept linted in opt-in mode. */
export const KEEP_TOOLING_FILES = `!${ROOT_TOOLING_FILES[0] ?? '*.{js,mjs,cjs,ts,mts,cts}'}`;

/** Module and name of ESLint's `globalIgnores()` helper. */
export const GLOBAL_IGNORES_MODULE = 'eslint/config';
export const GLOBAL_IGNORES = 'globalIgnores';

/** The patterns of the lint scope, without the defaults. */
const scopePatterns = (answers: IgnoresAnswers | undefined): string[] => {
  if (!answers || answers.mode === 'all' || answers.globs.length === 0) {
    return [];
  }
  if (answers.mode === 'exclude') {
    return answers.globs;
  }
  const skipped = answers.globs.filter((glob) => glob.startsWith('!'));
  const linted = answers.globs.filter((glob) => !glob.startsWith('!'));
  return [
    ...IGNORE_EVERYTHING,
    KEEP_TOOLING_FILES,
    ...linted.map((glob) => `!${glob}`),
    ...skipped.map((glob) => glob.slice(1)),
  ];
};

/**
 * The `globalIgnores([...])` patterns: the lint scope, then the defaults, so a negation such as
 * `!src/**` doesn't un-ignore `src/dist`.
 */
export const ignoresPatterns = (answers: IgnoresAnswers | undefined): string[] => [
  ...scopePatterns(answers),
  ...DEFAULT_IGNORES,
];

/**
 * Name of the generated ESLint config. A `.ts` file is an ES module only when package.json has
 * `"type": "module"`; `.mts` is always an ES module, so it is used for the other projects.
 */
export const eslintConfigFile = (isModulePackage: boolean): string =>
  isModulePackage ? 'eslint.config.ts' : 'eslint.config.mts';

/** Name of the generated Prettier config; `.ts` / `.mts` like the ESLint config. */
export const prettierConfigFile = (isModulePackage: boolean): string =>
  isModulePackage ? 'prettier.config.ts' : 'prettier.config.mts';

/** Generated Prettier config files, of which an existing one is kept and reused. */
export const PRETTIER_CONFIG_FILES = [prettierConfigFile(true), prettierConfigFile(false)];

export const SHARED_PRETTIER_CONFIG = '@uselab/linting/prettier';

const quote = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", String.raw`\'`)}'`;

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const isDefaultSrcDirs = (srcDirs: string[]): boolean =>
  sameList(srcDirs, DEFAULT_BOUNDARIES_SRC_DIRS);

/** Whether the test globs are the default ones (or not set). An empty list means no test files. */
export const isDefaultTestFiles = (testFiles: readonly string[] | undefined): boolean =>
  testFiles === undefined || sameList(testFiles, DEFAULT_TEST_FILES);

const stringOrArray = (value: string | string[]): string =>
  Array.isArray(value) ? `[${value.map(quote).join(', ')}]` : quote(value);

const boundariesOptions = (answers: BoundariesAnswers = {}): string => {
  const entries: string[] = [];
  if (answers.srcDirs && answers.srcDirs.length > 0 && !isDefaultSrcDirs(answers.srcDirs)) {
    entries.push(`srcDirs: ${stringOrArray(answers.srcDirs)}`);
  }
  const tsconfig =
    Array.isArray(answers.tsconfig) && answers.tsconfig.length === 1
      ? answers.tsconfig[0]
      : answers.tsconfig;
  if (tsconfig !== undefined && tsconfig.length > 0) {
    entries.push(`tsconfig: ${stringOrArray(tsconfig)}`);
  }
  return entries.length > 0 ? `{ ${entries.join(', ')} }` : '';
};

const javascriptOptions = (answers: JavaScriptAnswers = {}): string =>
  answers.testFiles === undefined || isDefaultTestFiles(answers.testFiles)
    ? ''
    : `{ testFiles: ${stringOrArray(answers.testFiles)} }`;

/** `{ key: [...] }`, or nothing without globs. */
export const globsOptions = (key: string, globs: readonly string[] | undefined): string =>
  globs === undefined || globs.length === 0 ? '' : `{ ${key}: ${stringOrArray([...globs])} }`;

/** Option key of the browser globs: `browser({ files })` and `node({ ignores })`. */
export const GLOBALS_OPTION_KEYS = { browser: 'files', node: 'ignores' } as const;

export type GlobalsPreset = keyof typeof GLOBALS_OPTION_KEYS;

/** The browser globs of a browser project, else none (the preset covers all files). */
const browserGlobs = (environment: EnvironmentAnswers | undefined): string[] | undefined =>
  environment?.type === 'browser' ? environment.browserFiles : undefined;

const presetLine = (preset: PresetId, answers: InitAnswers): string =>
  `  ...${presetExpression(preset, answers)},`;

/** Explanations of the opt-in prefix, written as trailing comments. */
const PATTERN_COMMENTS = new Map<string, string>([
  [IGNORE_EVERYTHING[0] ?? '**/*', 'ignore everything...'],
  [IGNORE_EVERYTHING[1] ?? '!**/*/', '...but look inside folders, so the patterns below can match'],
  [KEEP_TOOLING_FILES, 'lint root config files (eslint.config.ts, vite.config.ts, ...)'],
]);

const patternLine = (pattern: string, isOptIn: boolean): string => {
  const comment = isOptIn ? PATTERN_COMMENTS.get(pattern) : undefined;
  return `  ${quote(pattern)},${comment === undefined ? '' : ` // ${comment}`}`;
};

/** Expression of the global ignores, one pattern per line; the opt-in prefix is explained. */
export const ignoresExpression = (
  answers: IgnoresAnswers | undefined,
  local = GLOBAL_IGNORES,
): string => {
  const isOptIn = answers?.mode === 'only';
  const lines = ignoresPatterns(answers).map((pattern) => patternLine(pattern, isOptIn));
  return [`${local}([`, ...lines, '])'].join('\n');
};

/** The global ignores entry of the generated config. */
const ignoresLines = (answers: IgnoresAnswers | undefined): string[] =>
  `${ignoresExpression(answers)},`.split('\n').map((line) => `  ${line}`);

/**
 * Expression of a preset, e.g. `configs.typescript`, `configs.javascript({ ... })` or
 * `configs.boundaries({ ... })`.
 */
export const presetExpression = (
  preset: PresetId,
  answers: InitAnswers,
  local = 'configs',
): string => {
  if (preset === 'boundaries') {
    return `${local}.boundaries(${boundariesOptions(answers.boundaries)})`;
  }
  if (preset === 'javascript') {
    return `${local}.javascript(${javascriptOptions(answers.javascript)})`;
  }
  if (preset === 'browser' || preset === 'node') {
    const options = globsOptions(GLOBALS_OPTION_KEYS[preset], browserGlobs(answers.environment));
    return `${local}.${preset}(${options})`;
  }
  return `${local}.${preset}`;
};

/** Returns the presets in the canonical order, without duplicates. */
export const orderPresets = (presets: readonly PresetId[]): PresetId[] =>
  PRESET_ORDER.filter((preset) => presets.includes(preset));

/** Content of the generated `eslint.config.ts` / `eslint.config.mts`. */
export const generateEslintConfig = (answers: InitAnswers): string => {
  const lines = [
    `import { ${GLOBAL_IGNORES} } from '${GLOBAL_IGNORES_MODULE}';`,
    "import { configs } from '@uselab/linting';",
    '',
    'export default [',
    ...ignoresLines(answers.ignores),
    ...orderPresets(answers.presets).map((preset) => presetLine(preset, answers)),
    '];',
    '',
  ];
  return lines.join('\n');
};

/** Content of the generated `prettier.config.ts` / `.mts`: the shared config, spread to override. */
export const generatePrettierConfig = (): string =>
  [
    "import type { Config } from 'prettier';",
    `import uselab from '${SHARED_PRETTIER_CONFIG}';`,
    '',
    'const config: Config = {',
    '  ...uselab,',
    '  // add custom configuration here',
    '};',
    '',
    'export default config;',
    '',
  ].join('\n');
