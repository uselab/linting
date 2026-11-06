import type { PresetId } from './generate';
import { applyJsonChanges, type JsonChange } from './json-edit';
import type { TypecheckTarget } from './tsconfig';

const ESLINT_CACHE = '--cache --cache-location node_modules/.cache/eslint/';

/** Top-level package.json keys that conventionally come before `scripts`. */
const KEYS_BEFORE_SCRIPTS = [
  'name',
  'version',
  'private',
  'description',
  'type',
  'license',
  'author',
  'repository',
  'engines',
  'files',
  'bin',
  'main',
  'module',
  'types',
  'exports',
];

export type ScriptStatus = 'ok' | 'missing' | 'conflict';

export type ScriptCheck = {
  name: string;
  command: string;
  status: ScriptStatus;
  declared?: string;
};

/** `typecheck` command: `tsc` (or `vue-tsc` for Vue) in build mode or per tsconfig. */
export const typecheckCommand = (target: TypecheckTarget, vue: boolean): string => {
  const bin = vue ? 'vue-tsc' : 'tsc';
  if (target.build) {
    return `${bin} -b`;
  }
  return target.projects
    .map((project) =>
      project === 'tsconfig.json' ? `${bin} --noEmit` : `${bin} --noEmit -p ${project}`,
    )
    .join(' && ');
};

/** The lint, format and typecheck scripts for the selected presets. */
export const requiredScripts = (
  presets: readonly PresetId[],
  typecheck?: string,
): Record<string, string> => ({
  lint: `eslint . ${ESLINT_CACHE}`,
  'lint:fix': `eslint . --fix ${ESLINT_CACHE}`,
  'lint:analyze': 'uselab-linting analyze',
  ...(presets.includes('prettier')
    ? { format: 'prettier --write .', 'format:check': 'prettier --check .' }
    : {}),
  ...(typecheck === undefined ? {} : { typecheck }),
});

/**
 * Compares the declared scripts with the required ones; existing different scripts are conflicts
 * (which are overwritten).
 */
export const checkScripts = (
  declared: Record<string, string> | undefined,
  required: Record<string, string>,
): ScriptCheck[] =>
  Object.entries(required).map(([name, command]) => {
    const current = declared?.[name];
    if (current === undefined) {
      return { name, command, status: 'missing' };
    }
    return { name, command, declared: current, status: current === command ? 'ok' : 'conflict' };
  });

const REMOVED_TOOL_COMMAND =
  /(?:^|[\s;&|(])(?:biome|rome|tslint|xo|ts-standard|standard|oxlint|dprint)(?=$|[\s;&|)])/;

/** Names of scripts (other than `ignore`) that still run lint/format tools that were removed. */
export const findStaleScripts = (
  declared: Record<string, string> | undefined,
  ignore: readonly string[],
): string[] =>
  Object.entries(declared ?? {})
    .filter(([name, command]) => !ignore.includes(name) && REMOVED_TOOL_COMMAND.test(command))
    .map(([name]) => name);

/**
 * Writes the given scripts to package.json, preserving formatting. Existing scripts are
 * overwritten in place, new ones are appended; a missing `scripts` object is created before the
 * dependencies.
 */
export const addScripts = (
  text: string,
  hasScripts: boolean,
  checks: readonly ScriptCheck[],
): string => {
  if (checks.length === 0) {
    return text;
  }
  if (!hasScripts) {
    return applyJsonChanges(text, [
      {
        path: ['scripts'],
        value: Object.fromEntries(checks.map(({ name, command }) => [name, command])),
        insertAfter: KEYS_BEFORE_SCRIPTS,
      },
    ]);
  }
  return applyJsonChanges(
    text,
    checks.map(({ name, command }): JsonChange => ({
      path: ['scripts', name],
      value: command,
      append: true,
    })),
  );
};
