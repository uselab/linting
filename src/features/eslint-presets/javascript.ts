import js from '@eslint/js';
import { importX } from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import { devSeverity, restrictedSyntax } from '../../support/env';
import {
  ROOT_TOOLING_FILES,
  scopeConfigs,
  type Config,
  type PresetOptions,
  type Rules,
} from '../../support/shared';

const houseRules: Rules = {
  'no-alert': 'error',
  'no-continue': 'error',
  'no-param-reassign': ['error', { props: true }],
  'no-implicit-coercion': ['error', { boolean: true }],
  'default-case': ['error', { commentPattern: '^no default$' }],
  'no-restricted-syntax': restrictedSyntax,
  'import-x/no-unresolved': 'off',
  'import-x/no-named-as-default-member': 'off',
  'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': [
    'error',
    { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  complexity: ['error', 10],
  'max-depth': ['error', 4],
  'max-params': ['error', { max: 3 }],
  'prefer-arrow-callback': ['error', { allowNamedFunctions: false }],
  'func-style': ['error', 'expression', { allowArrowFunctions: true }],
  'no-else-return': 'error',
  'no-plusplus': 'error',
  'sonarjs/duplicates-in-character-class': 'error',
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-duplicate-in-composite': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-identical-conditions': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-same-argument-assert': 'error',
  'sonarjs/no-same-line-conditional': 'error',
  'sonarjs/no-nested-switch': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'unicorn/filename-case': ['error', { case: 'kebabCase' }],
  'unicorn/no-lonely-if': 'error',
  'unicorn/no-useless-undefined': 'error',
  'unicorn/prefer-at': 'error',
  'unicorn/prefer-structured-clone': 'error',
};

export type JavaScriptOptions = PresetOptions & {
  /**
   * Globs of test files, which get relaxed rules (no `max-lines` / `max-lines-per-function`).
   * No default: without test files (omitted or `[]`) no rules are relaxed.
   */
  testFiles?: string[];
};

// Built at load time, like the other presets, so dev mode is evaluated when the module loads.
const devRules: Rules = {
  'no-debugger': devSeverity(),
  'no-console': devSeverity(),
  'no-unused-vars': devSeverity(),
};

/**
 * Base preset for every project: ESLint recommended, import-x, sonarjs, unicorn and the
 * Uselab house rules. Also configures root-level tooling files and *.cjs files for Node.
 */
export const javascript = (options: JavaScriptOptions = {}): Config[] => {
  const testFiles = options.testFiles ?? [];
  return scopeConfigs(
    [
      { name: 'uselab/javascript/recommended', ...js.configs.recommended },
      { ...importX.flatConfigs.recommended, name: 'uselab/javascript/import-x' },
      {
        name: 'uselab/javascript/rules',
        plugins: { sonarjs, unicorn },
        rules: { ...houseRules, ...devRules },
      },
      {
        name: 'uselab/javascript/commonjs',
        files: ['**/*.cjs'],
        languageOptions: {
          sourceType: 'commonjs',
          globals: { ...globals.node },
        },
      },
      {
        name: 'uselab/javascript/tooling-files',
        files: ROOT_TOOLING_FILES,
        languageOptions: {
          globals: { ...globals.node },
        },
        rules: {
          'no-console': 'off',
        },
      },
      // ESLint rejects an empty `files` array, so there is no tests block without test files.
      ...((testFiles.length === 0
        ? []
        : [
            {
              name: 'uselab/javascript/tests',
              files: testFiles,
              rules: {
                'max-lines': 'off',
                'max-lines-per-function': 'off',
              },
            },
          ]) satisfies Config[]),
      {
        name: 'uselab/javascript/eslint-config',
        files: ['eslint.config.*'],
        rules: {
          'max-lines': 'off',
        },
      },
    ],
    options,
  );
};
