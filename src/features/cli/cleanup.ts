import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import type { PackageJson } from './dependencies';
import { applyJsonChanges } from './json-edit';

/** Flat config files in the order ESLint looks for them; the first one found is used. */
export const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

const LEGACY_ESLINT_FILES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintignore',
];

const OTHER_PRETTIER_CONFIGS = [
  '.prettierrc',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.js',
  '.prettierrc.mjs',
  '.prettierrc.cjs',
  '.prettierrc.ts',
  '.prettierrc.mts',
  '.prettierrc.cts',
  '.prettierrc.toml',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.cjs',
  'prettier.config.ts',
  'prettier.config.mts',
  'prettier.config.cts',
];

const OTHER_TOOL_CONFIGS = [
  'biome.json',
  'biome.jsonc',
  'rome.json',
  'tslint.json',
  'tslint.yaml',
  '.xo-config',
  '.xo-config.json',
  '.xo-config.js',
  '.xo-config.cjs',
  'xo.config.js',
  'xo.config.cjs',
  'xo.config.mjs',
  'xo.config.ts',
  '.oxlintrc.json',
  'oxlintrc.json',
  'dprint.json',
  'dprint.jsonc',
  '.dprint.json',
  '.dprint.jsonc',
];

/** Lint/format config files that init replaces or removes. */
export const TOOLING_FILES = [
  ...ESLINT_CONFIGS,
  ...LEGACY_ESLINT_FILES,
  ...OTHER_PRETTIER_CONFIGS,
  ...OTHER_TOOL_CONFIGS,
];

const TOOLING_PACKAGE_JSON_KEYS = ['eslintConfig', 'eslintIgnore', 'prettier', 'standard', 'xo'];

const REMOVABLE_DEPENDENCIES = [
  /^@eslint\//,
  /^eslint-(?:plugin|config|import-resolver|formatter)-/,
  /^@[^/]+\/eslint-(?:plugin|config)(?:-|$)/,
  /^@typescript-eslint\//,
  /^typescript-eslint$/,
  /^vue-eslint-parser$/,
  /^@babel\/eslint-parser$/,
  /^@rushstack\/eslint-patch$/,
  /^eslint-define-config$/,
  /^@eslint-react\//,
  /^prettier-plugin-/,
  /^@[^/]+\/prettier-plugin(?:-|$)/,
  /^@prettier\/plugin-/,
  /^@biomejs\/biome$/,
  /^rome$/,
  /^tslint(?:-|$)/,
  /^(?:ts-)?standard$/,
  /^xo$/,
  /^oxlint$/,
  /^dprint$/,
];

/** Lint/format packages replaced by @uselab/linting (eslint, prettier, jiti etc. are kept). */
export const isRemovableDependency = (name: string): boolean =>
  REMOVABLE_DEPENDENCIES.some((pattern) => pattern.test(name));

export type DependencyField = 'dependencies' | 'devDependencies';

export type ToolingReport = {
  files: string[];
  packageJsonKeys: string[];
  dependencies: { field: DependencyField; name: string }[];
};

type ToolingPackageJson = PackageJson & Record<string, unknown>;

/** Finds the existing lint/format tooling of a project, except the files to keep. */
export const findExistingTooling = (
  projectDir: string,
  packageJson: ToolingPackageJson | undefined,
  keepFiles: readonly string[],
): ToolingReport => {
  const files = TOOLING_FILES.filter(
    (file) => !keepFiles.includes(file) && existsSync(path.join(projectDir, file)),
  );
  const packageJsonKeys = TOOLING_PACKAGE_JSON_KEYS.filter(
    (key) => packageJson?.[key] !== undefined,
  );
  const fields: DependencyField[] = ['dependencies', 'devDependencies'];
  const dependencies = fields.flatMap((field) =>
    Object.keys(packageJson?.[field] ?? {})
      .filter(isRemovableDependency)
      .map((name) => ({ field, name })),
  );
  return { files, packageJsonKeys, dependencies };
};

export const isEmptyReport = ({ files, packageJsonKeys, dependencies }: ToolingReport): boolean =>
  files.length === 0 && packageJsonKeys.length === 0 && dependencies.length === 0;

/** Removes the reported keys and dependencies from package.json, preserving formatting. */
export const removeFromPackageJson = (text: string, report: ToolingReport): string =>
  applyJsonChanges(text, [
    ...report.packageJsonKeys.map((key) => ({ path: [key], value: undefined })),
    ...report.dependencies.map(({ field, name }) => ({ path: [field, name], value: undefined })),
  ]);

const describeReport = ({ files, packageJsonKeys, dependencies }: ToolingReport): string =>
  [
    ...files,
    ...packageJsonKeys.map((key) => `package.json "${key}"`),
    ...dependencies.map(({ name }) => `${name} (package)`),
  ].join('\n');

/** Removes the existing lint/format tooling: config files, package.json keys and packages. */
export const removeExistingTooling = (
  projectDir: string,
  report: ToolingReport,
  packageJsonText: string | undefined,
): void => {
  if (isEmptyReport(report)) {
    return;
  }
  clack.note(describeReport(report), 'Removing existing lint/format tooling');
  for (const file of report.files) {
    rmSync(path.join(projectDir, file));
  }
  const changesPackageJson = report.packageJsonKeys.length > 0 || report.dependencies.length > 0;
  if (packageJsonText !== undefined && changesPackageJson) {
    writeFileSync(
      path.join(projectDir, 'package.json'),
      removeFromPackageJson(packageJsonText, report),
    );
  }
  clack.log.success('Removed existing lint/format tooling.');
};
