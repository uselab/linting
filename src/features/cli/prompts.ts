import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { DEFAULT_IGNORES } from '../../support/ignores';
import {
  QUERY_LIBRARIES,
  type QueryLibrary,
  type QueryLibraryId,
} from '../../support/query-libraries';
import { hasNestedSrcDirs, NESTED_SRC_DIRS_MESSAGE } from '../../support/source-tsconfig';
import { excludeTestSrcDirs } from './detect';
import {
  environmentPresets,
  orderPresets,
  type BoundariesAnswers,
  type EnvironmentAnswers,
  type IgnoresAnswers,
  type IgnoresMode,
  type InitAnswers,
  type JavaScriptAnswers,
  type PresetId,
  type ProjectType,
  type QueryAnswers,
} from './generate';

const isAnswer = <T>(value: T): value is Exclude<T, symbol> => !clack.isCancel(value);

/** Returns the prompt value, or exits cleanly when the user cancelled (Ctrl+C / Esc). */
export const unwrap = <T>(value: T): Exclude<T, symbol> => {
  if (isAnswer(value)) {
    return value;
  }
  clack.cancel('Cancelled.');
  return process.exit(0);
};

const PRESET_OPTIONS: { value: PresetId; label: string; hint: string }[] = [
  { value: 'javascript', label: 'javascript', hint: 'base rules, required by the other presets' },
  { value: 'typescript', label: 'typescript', hint: 'typescript-eslint for .ts/.tsx/.vue' },
  { value: 'prettier', label: 'prettier', hint: 'disables conflicting rules + .prettierrc.json' },
  { value: 'vue', label: 'vue', hint: 'eslint-plugin-vue + Vue house rules' },
  {
    value: 'vueA11y',
    label: 'vueA11y',
    hint: 'accessibility rules for Vue templates (needs vue; React support planned)',
  },
  { value: 'react', label: 'react', hint: '@eslint-react + react-hooks' },
  {
    value: 'query',
    label: 'query',
    hint: 'no fetch / axios outside src/support/http; use vue-query, react-query, swr, ... (needs vue or react)',
  },
  {
    value: 'aliases',
    label: 'aliases',
    hint: '@app / @features / @support instead of ../ imports; needs a bundler such as Vite',
  },
  {
    value: 'boundaries',
    label: 'boundaries',
    hint: 'project structure, guided by the principles of Domain-Driven Design (DDD): app / features / support',
  },
];

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const asList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : [value].flat();

const isKind = (file: string, kind: 'file' | 'directory'): boolean =>
  existsSync(file) && (kind === 'file' ? statSync(file).isFile() : statSync(file).isDirectory());

const missingMessage = (missing: string[], noun: string): string =>
  `${noun} not found in the project: ${missing.join(', ')}`;

/** Validates the src folders answer: at least one, and each must be a folder in the project. */
export const validateSrcDirs = (
  projectDir: string,
  value: string | undefined,
): string | undefined => {
  const dirs = splitList(value ?? '');
  if (dirs.length === 0) {
    return 'Enter at least one folder.';
  }
  const missing = dirs.filter((dir) => !isKind(path.resolve(projectDir, dir), 'directory'));
  if (missing.length > 0) {
    return missingMessage(missing, 'Folder(s)');
  }
  return hasNestedSrcDirs(dirs) ? NESTED_SRC_DIRS_MESSAGE : undefined;
};

/** Validates the tsconfig answer: empty is allowed, else each must be a file in the project. */
export const validateTsconfigs = (
  projectDir: string,
  value: string | undefined,
): string | undefined => {
  const missing = splitList(value ?? '').filter(
    (file) => !isKind(path.resolve(projectDir, file), 'file'),
  );
  return missing.length > 0 ? missingMessage(missing, 'File(s)') : undefined;
};

/** Splits a comma separated list of globs, ignoring commas inside `{...}` braces. */
export const splitGlobs = (value: string): string[] => {
  const globs: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === ',' && depth === 0) {
      globs.push(current);
      current = '';
    } else {
      current += char;
      if (char === '{') {
        depth += 1;
      } else if (char === '}' && depth > 0) {
        depth -= 1;
      }
    }
  }
  globs.push(current);
  return globs.map((glob) => glob.trim()).filter((glob) => glob.length > 0);
};

const PROJECT_TYPE_OPTIONS: { value: ProjectType; label: string; hint: string }[] = [
  {
    value: 'browser',
    label: 'Browser project',
    hint: 'browser globals + no imperative DOM mutation for the browser files; Node globals elsewhere',
  },
  { value: 'node', label: 'Node project', hint: 'Node.js globals for all files' },
];

/** Validates the browser globs: at least one, and no `!` negations. */
export const validateBrowserGlobs = (value: string | undefined): string | undefined => {
  const globs = splitGlobs(value ?? '');
  if (globs.length === 0) {
    return 'Enter at least one glob.';
  }
  return globs.some((glob) => glob.startsWith('!')) ? "Don't start globs with '!'." : undefined;
};

/** Asks whether this is a browser or Node project, and the browser globs of a browser project. */
const askEnvironment = async (
  initialType: ProjectType,
  initialBrowserFiles: readonly string[],
): Promise<EnvironmentAnswers> => {
  const type = unwrap(
    await clack.select<ProjectType>({
      message: 'Is this a browser or a Node project?',
      options: PROJECT_TYPE_OPTIONS,
      initialValue: initialType,
    }),
  );
  if (type === 'node') {
    return { type, browserFiles: [] };
  }
  const browserFiles = splitGlobs(
    unwrap(
      await clack.text({
        message:
          'Browser files: globs that get browser globals (comma separated; other files are Node)',
        placeholder: 'src/**',
        initialValue: initialBrowserFiles.join(', '),
        validate: validateBrowserGlobs,
      }),
    ),
  );
  return { type, browserFiles };
};

/** The libraries of the selected frameworks; all of them when neither Vue nor React is selected. */
export const queryLibraryOptions = (presets: readonly PresetId[]): QueryLibrary[] => {
  const frameworks = (['vue', 'react'] as const).filter((framework) => presets.includes(framework));
  const matching = QUERY_LIBRARIES.filter(({ framework }) => frameworks.includes(framework));
  return matching.length > 0 ? matching : [...QUERY_LIBRARIES];
};

const askQuery = async (
  presets: readonly PresetId[],
  initial: QueryAnswers | undefined,
  detected: QueryLibraryId | undefined,
): Promise<QueryAnswers> => {
  const libraries = queryLibraryOptions(presets);
  const preferred = [initial?.library, detected].find((id) =>
    libraries.some((library) => library.id === id),
  );
  const library = unwrap(
    await clack.select<QueryLibraryId>({
      message: 'Which library handles server state (replaces fetch / axios)?',
      options: libraries.map(({ id, label, framework }) => ({
        value: id,
        label,
        hint: libraries.length > 3 ? framework : undefined,
      })),
      initialValue: preferred ?? libraries[0]?.id,
    }),
  );
  return { library, allow: initial?.allow };
};

const askJavascript = async (
  initial: JavaScriptAnswers | undefined,
  detectedTestFiles: readonly string[],
): Promise<JavaScriptAnswers> => {
  const testFiles = splitGlobs(
    unwrap(
      await clack.text({
        message:
          'Test files: globs of files with relaxed rules (comma separated, empty = no test files)',
        initialValue: (initial?.testFiles ?? detectedTestFiles).join(', '),
        defaultValue: '',
      }),
    ),
  );
  return { testFiles };
};

const askBoundaries = async (
  defaults: BoundariesDefaults,
  initial: BoundariesAnswers | undefined,
  testFiles: readonly string[],
): Promise<BoundariesAnswers> => {
  const srcDirs = splitList(
    unwrap(
      await clack.text({
        message:
          'Project structure (DDD): src folders with the app / features / support layout (comma separated)',
        initialValue: (initial?.srcDirs ?? excludeTestSrcDirs(defaults.srcDirs, testFiles)).join(
          ', ',
        ),
        validate: (value) => validateSrcDirs(defaults.projectDir, value),
      }),
    ),
  );
  const detected = defaults.tsconfigsFor(srcDirs);
  const tsconfig = splitList(
    unwrap(
      await clack.text({
        message:
          'Project structure (DDD): tsconfig(s) that include these src folders, used to resolve imports (comma separated, empty = auto-detect)',
        placeholder: 'tsconfig.app.json',
        initialValue: asList(initial?.tsconfig ?? detected).join(', '),
        defaultValue: '',
        validate: (value) => validateTsconfigs(defaults.projectDir, value),
      }),
    ),
  );
  return {
    srcDirs,
    tsconfig: tsconfig.length === 0 ? undefined : tsconfig,
  };
};

const IGNORES_OPTIONS: { value: IgnoresMode; label: string; hint: string }[] = [
  { value: 'all', label: 'All files', hint: 'the whole project' },
  {
    value: 'exclude',
    label: 'All files except some globs (opt-out)',
    hint: 'e.g. legacy folders',
  },
  {
    value: 'only',
    label: 'Only specific globs (opt-in)',
    hint: 'root config files are still linted; include test/** to lint tests',
  },
];

const DEFAULT_OPT_IN_GLOBS = ['src/**'];

/** The default ignores as short names, e.g. `dist` for `**\/dist/**`. */
const defaultIgnoreNames = (): string[] =>
  DEFAULT_IGNORES.map((pattern) => pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, ''));

/** Added to the lint scope question, as the defaults apply whichever scope is chosen. */
export const DEFAULT_IGNORES_MESSAGE = `${defaultIgnoreNames().join(', ')} are always ignored`;

/**
 * Validates the globs: at least one is required. Opt-in globs may start with `!` to skip files
 * within the linted ones, as long as at least one glob is linted; opt-out globs may not.
 */
const validateIgnoreGlobs =
  (mode: Exclude<IgnoresMode, 'all'>) =>
  (value: string | undefined): string | undefined => {
    const globs = splitGlobs(value ?? '');
    if (globs.length === 0) {
      return 'Enter at least one glob.';
    }
    const skipped = globs.filter((glob) => glob.startsWith('!'));
    if (mode === 'exclude') {
      return skipped.length > 0 ? "Don't start globs with '!'." : undefined;
    }
    return skipped.length === globs.length
      ? "Enter at least one glob to lint (without '!')."
      : undefined;
  };

const OPT_IN_MESSAGE = "Globs of the files to lint (comma separated; '!glob' skips files in them";

const askIgnoreGlobs = async (
  mode: Exclude<IgnoresMode, 'all'>,
  initial: IgnoresAnswers | undefined,
): Promise<string[]> => {
  const initialGlobs =
    initial?.mode === mode ? initial.globs : mode === 'only' ? DEFAULT_OPT_IN_GLOBS : [];
  return splitGlobs(
    unwrap(
      await clack.text({
        message:
          mode === 'only' ? `${OPT_IN_MESSAGE})` : 'Globs of the files to skip (comma separated)',
        placeholder: mode === 'only' ? 'src/**, test/**, !src/legacy/**' : 'legacy/**, src/old/**',
        initialValue: initialGlobs.join(', '),
        validate: validateIgnoreGlobs(mode),
      }),
    ),
  );
};

/** Asks which files ESLint lints: all, all except some globs (opt-out) or only some (opt-in). */
const askIgnores = async (initial: IgnoresAnswers | undefined): Promise<IgnoresAnswers> => {
  const mode = unwrap(
    await clack.select<IgnoresMode>({
      message: `Which files should ESLint lint? (${DEFAULT_IGNORES_MESSAGE})`,
      options: IGNORES_OPTIONS,
      initialValue: initial?.mode ?? 'all',
    }),
  );
  return mode === 'all'
    ? { mode, globs: [] }
    : { mode, globs: await askIgnoreGlobs(mode, initial) };
};

const validateEditedGlobs =
  (optIn: boolean) =>
  (value: string | undefined): string | undefined =>
    splitGlobs(value ?? '').length === 0 && !optIn
      ? undefined
      : validateIgnoreGlobs(optIn ? 'only' : 'exclude')(value);

/**
 * Asks only for the globs of the current lint scope: the files to lint for an opt-in scope, else
 * the files to skip, where no globs lints all files. `relativeTo` names the folder the globs are
 * relative to, when that isn't obvious.
 */
export const askScopeGlobs = async (
  current: IgnoresAnswers,
  relativeTo?: string,
): Promise<IgnoresAnswers> => {
  const optIn = current.mode === 'only';
  const relative = relativeTo === undefined ? '' : `, relative to ${relativeTo}`;
  const globs = splitGlobs(
    unwrap(
      await clack.text({
        message: optIn
          ? `${OPT_IN_MESSAGE}${relative})`
          : `Globs of the files to skip (comma separated${relative}; empty lints all files)`,
        placeholder: optIn ? 'src/**, test/**, !src/legacy/**' : 'legacy/**, src/old/**',
        initialValue: current.globs.join(', '),
        validate: validateEditedGlobs(optIn),
      }),
    ) ?? '',
  );
  if (optIn) {
    return { mode: 'only', globs };
  }
  return globs.length === 0 ? { mode: 'all', globs } : { mode: 'exclude', globs };
};

export type BoundariesDefaults = {
  /** The project the answered folders and files are relative to. */
  projectDir: string;
  /** Detected src folders. */
  srcDirs: string[];
  /** The tsconfigs that include the given src folders. */
  tsconfigsFor: (srcDirs: string[]) => string[];
};

export type AskOptions = {
  initialPresets: PresetId[];
  /** Initial project type: of an existing config, else the detected one. */
  initialProjectType: ProjectType;
  /** Initial browser globs: of an existing config, else the detected src folders. */
  initialBrowserFiles: string[];
  boundariesDefaults: BoundariesDefaults;
  /** Detected test file globs, used when there is no existing `testFiles` option. */
  detectedTestFiles: readonly string[];
  /** javascript options of an existing config, used as initial values. */
  initialJavascript?: JavaScriptAnswers;
  /** Boundaries options of an existing config, used as initial values. */
  initialBoundaries?: BoundariesAnswers;
  /** Query options of an existing config, used as initial values. */
  initialQuery?: QueryAnswers;
  /** The detected query library of the project's framework. */
  detectedQueryLibrary?: QueryLibraryId;
  /** Lint scope of an existing config, used as initial value. Undefined when it isn't editable. */
  initialIgnores?: IgnoresAnswers;
  /** False when the existing `globalIgnores()` can't be rewritten; the scope isn't asked then. */
  ignoresEditable?: boolean;
};

const warnAboutPresets = (presets: PresetId[]): void => {
  if (!presets.includes('javascript')) {
    clack.log.warn('The other presets build on `javascript`; you probably want to include it.');
  }
  if (presets.includes('vueA11y') && !presets.includes('vue')) {
    clack.log.warn('`vueA11y` only checks .vue files; you probably want to include `vue`.');
  }
  if (presets.includes('query') && !presets.includes('vue') && !presets.includes('react')) {
    clack.log.warn('`query` is meant for Vue or React projects; you probably want to include one.');
  }
  if (presets.includes('vue') && presets.includes('react')) {
    clack.log.warn('Both vue and react are selected. That is unusual, but allowed.');
  }
};

/**
 * Asks the project type, the browser globs of a browser project, which presets to use, plus the
 * test file globs when javascript is selected, the boundaries options when boundaries is
 * selected and which files ESLint lints.
 */
export const askAnswers = async ({
  initialPresets,
  initialProjectType,
  initialBrowserFiles,
  boundariesDefaults,
  detectedTestFiles,
  initialJavascript,
  initialBoundaries,
  initialQuery,
  detectedQueryLibrary,
  initialIgnores,
  ignoresEditable = true,
}: AskOptions): Promise<InitAnswers> => {
  const environment = await askEnvironment(initialProjectType, initialBrowserFiles);
  // Node doesn't resolve the aliases, so a Node project can't use the aliases preset.
  const options = PRESET_OPTIONS.filter(
    ({ value }) => !(environment.type === 'node' && value === 'aliases'),
  );
  const selected = unwrap(
    await clack.multiselect<PresetId>({
      message: 'Which presets do you want?',
      options,
      initialValues: initialPresets.filter((preset) =>
        options.some(({ value }) => value === preset),
      ),
      required: true,
    }),
  );
  const presets = orderPresets([...selected, ...environmentPresets(environment.type)]);
  warnAboutPresets(presets);
  const javascript = presets.includes('javascript')
    ? await askJavascript(initialJavascript, detectedTestFiles)
    : undefined;
  const boundaries = presets.includes('boundaries')
    ? await askBoundaries(
        boundariesDefaults,
        initialBoundaries,
        javascript?.testFiles ?? detectedTestFiles,
      )
    : undefined;
  const query = presets.includes('query')
    ? await askQuery(presets, initialQuery, detectedQueryLibrary)
    : undefined;
  const ignores = ignoresEditable ? await askIgnores(initialIgnores) : undefined;
  return { presets, javascript, boundaries, query, environment, ignores };
};

export const confirm = async (message: string, initialValue = true): Promise<boolean> =>
  unwrap(await clack.confirm({ message, initialValue }));
