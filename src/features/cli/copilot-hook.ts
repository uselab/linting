import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ESLint } from 'eslint';
import type * as PrettierModule from 'prettier';

type Prettier = typeof PrettierModule;

/** Repository hook file read by Copilot CLI and Copilot in the cloud. */
export const COPILOT_HOOK_FILE = '.github/hooks/uselab-linting.json';
export const COPILOT_HOOK_COMMAND = 'npx --no uselab-linting copilot-hook';
/** Copilot tools that edit files. */
export const COPILOT_HOOK_MATCHER = 'edit|create|apply_patch|str_replace_editor';
const ESLINT_CACHE = 'node_modules/.cache/eslint/';

/** Input of a Copilot `postToolUse` hook (camelCase format). */
export type HookInput = { cwd?: unknown; toolName?: unknown; toolArgs?: unknown };

/** The hook config; `cwd` is the project directory relative to the repository root. */
export const copilotHookConfig = (cwd: string | undefined): string => {
  const hook = {
    type: 'command',
    matcher: COPILOT_HOOK_MATCHER,
    command: COPILOT_HOOK_COMMAND,
    ...(cwd ? { cwd } : {}),
    timeoutSec: 60,
  };
  return `${JSON.stringify({ version: 1, hooks: { postToolUse: [hook] } }, undefined, 2)}\n`;
};

/** The closest directory with a `.git` entry, or the project directory itself. */
export const findRepositoryRoot = (projectDir: string, dir = projectDir): string => {
  if (existsSync(path.join(dir, '.git'))) {
    return dir;
  }
  const parent = path.dirname(dir);
  return parent === dir ? projectDir : findRepositoryRoot(projectDir, parent);
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value instanceof Object;

const isString = (value: unknown): value is string => typeof value === 'string';

const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gmu;

const patchFiles = (patch: string): string[] =>
  [...patch.matchAll(PATCH_FILE)].map((match) => (match[1] ?? '').trim());

const argFiles = (args: unknown): string[] => {
  if (isString(args)) {
    return patchFiles(args);
  }
  if (!isRecord(args) || args.command === 'view') {
    return [];
  }
  const patch = [args.input, args.patch].find(isString);
  return patch === undefined
    ? [args.path, args.file_path, args.filePath].filter(isString)
    : patchFiles(patch);
};

/** Absolute paths of the files an edit tool changed (`toolArgs` may be a JSON string or a patch). */
export const editedFiles = (input: HookInput): string[] => {
  const args = isString(input.toolArgs)
    ? (parseJson(input.toolArgs) ?? input.toolArgs)
    : input.toolArgs;
  const base = isString(input.cwd) ? input.cwd : process.cwd();
  return [...new Set(argFiles(args).map((file) => path.resolve(base, file)))];
};

const isInside = (dir: string, file: string): boolean => {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** The real paths (no symlinks or short names) of the existing files inside the project. */
export const projectFiles = (projectDir: string, files: string[]): string[] => {
  const realDir = realpathSync.native(projectDir);
  return files
    .filter((file) => existsSync(file) && statSync(file).isFile())
    .map((file) => realpathSync.native(file))
    .filter((file) => isInside(realDir, file));
};

const loadPrettier = async (): Promise<Prettier | undefined> => {
  try {
    return await import('prettier');
  } catch {
    // prettier is an optional peer dependency
  }
};

/** Formats the file when Prettier is configured for it. Returns whether it changed. */
const formatFile = async (prettier: Prettier, file: string, ignorePath: string[]) => {
  const info = await prettier.getFileInfo(file, { ignorePath, resolveConfig: true });
  const options = await prettier.resolveConfig(file, { editorconfig: true });
  if (info.ignored || !info.inferredParser || !options) {
    return false;
  }
  const source = readFileSync(file, 'utf8');
  const output = await prettier.format(source, { ...options, filepath: file }).catch(() => source);
  if (output === source) {
    return false;
  }
  writeFileSync(file, output);
  return true;
};

const formatFiles = async (projectDir: string, files: string[]): Promise<string[]> => {
  const prettier = files.length > 0 ? await loadPrettier() : undefined;
  if (!prettier) {
    return [];
  }
  const ignorePath = ['.gitignore', '.prettierignore']
    .map((file) => path.join(projectDir, file))
    .filter((file) => existsSync(file));
  const changed = await Promise.all(
    files.map(async (file) => ((await formatFile(prettier, file, ignorePath)) ? file : undefined)),
  );
  return changed.filter(isString);
};

const lintFiles = async (projectDir: string, files: string[]): Promise<ESLint.LintResult[]> => {
  const { ESLint: Linter } = await import('eslint');
  const eslint = new Linter({
    cwd: projectDir,
    fix: true,
    cache: true,
    cacheLocation: ESLINT_CACHE,
    warnIgnored: false,
  });
  const results = await eslint.lintFiles(files);
  await Linter.outputFixes(results);
  return results;
};

const relativePath = (projectDir: string, file: string): string =>
  path.relative(projectDir, file).split(path.sep).join('/');

const describeErrors = (projectDir: string, results: ESLint.LintResult[]): string[] =>
  results.flatMap(({ filePath, messages }) =>
    messages
      .filter(({ severity }) => severity === 2)
      .map(
        ({ line, column, message, ruleId }) =>
          `${relativePath(projectDir, filePath)}:${line}:${column}  ${message}${ruleId ? `  (${ruleId})` : ''}`,
      ),
  );

/**
 * Formats the files with Prettier, then runs `eslint --fix` (formatting again when ESLint changed
 * something). Returns `ok`, or the remaining errors, as context for the agent.
 */
export const lintEditedFiles = async (projectDir: string, files: string[]): Promise<string> => {
  const formatted = await formatFiles(projectDir, files);
  const results = await lintFiles(projectDir, files);
  const fixed = results
    .filter(({ output }) => output !== undefined)
    .map(({ filePath }) => filePath);
  await formatFiles(projectDir, fixed);
  const errors = describeErrors(projectDir, results);
  const lines =
    errors.length === 0
      ? ['uselab-linting: ok']
      : [`uselab-linting: ${errors.length} lint error(s) remain after autofix:`, ...errors];
  const changed = [...new Set([...formatted, ...fixed])];
  if (changed.length > 0) {
    const list = changed.map((file) => relativePath(projectDir, file)).join(', ');
    lines.push(`Auto-fixed/formatted ${list}; view the file before editing it again.`);
  }
  return lines.join('\n');
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const writeJson = (value: object): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

export const COPILOT_HOOK_STDIN_MESSAGE = `copilot-hook reads a Copilot postToolUse payload from stdin, e.g.:
  echo '{"toolName":"edit","toolArgs":{"path":"src/main.ts"}}' | npx uselab-linting copilot-hook`;

/** The `copilot-hook` command: a `postToolUse` hook run in the project directory. */
export const runCopilotHook = async (cwd = process.cwd()): Promise<void> => {
  if (process.stdin.isTTY) {
    process.stderr.write(`${COPILOT_HOOK_STDIN_MESSAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const input = parseJson(await readStdin());
  const projectDir = realpathSync.native(cwd);
  const files = projectFiles(projectDir, editedFiles(isRecord(input) ? input : {}));
  if (files.length === 0) {
    return;
  }
  writeJson({
    type: 'progress',
    message: 'uselab-linting: linting and formatting',
    temporary: true,
  });
  try {
    writeJson({ additionalContext: await lintEditedFiles(projectDir, files) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson({ additionalContext: `uselab-linting: hook failed: ${message}` });
  }
};
