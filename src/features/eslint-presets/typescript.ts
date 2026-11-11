import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';
import { devSeverity } from '../../support/env';
import {
  ROOT_TOOLING_FILES,
  scopeConfigs,
  TS_FILES,
  VUE_FILES,
  type Config,
  type PresetOptions,
} from '../../support/shared';

const TS_AND_VUE_FILES = [...TS_FILES, ...VUE_FILES];

const [, eslintRecommended, recommended] = tseslint.configs.recommended;

// Drop the name-based resolver; we pass the resolver instance via `import-x/resolver-next`
// so it works regardless of how the consumer's package manager hoists dependencies.
const importXTypescriptSettings = Object.fromEntries(
  Object.entries(importX.flatConfigs.typescript.settings ?? {}).filter(
    ([key]) => key !== 'import-x/resolver',
  ),
);

/**
 * TypeScript preset: typescript-eslint recommended + Uselab TS house rules.
 * Applies to .ts/.tsx/.mts/.cts and .vue files (for <script lang="ts">).
 */
const typescriptConfigs: Config[] = [
  {
    name: 'uselab/typescript/plugin',
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  {
    name: 'uselab/typescript/parser',
    files: TS_FILES,
    languageOptions: { parser: tseslint.parser, sourceType: 'module' },
  },
  {
    name: 'uselab/typescript/eslint-recommended',
    files: TS_AND_VUE_FILES,
    rules: eslintRecommended?.rules,
  },
  {
    name: 'uselab/typescript/recommended',
    files: TS_AND_VUE_FILES,
    rules: recommended?.rules,
  },
  {
    ...importX.flatConfigs.typescript,
    name: 'uselab/typescript/import-x',
    settings: {
      ...importXTypescriptSettings,
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
  },
  {
    name: 'uselab/typescript/rules',
    files: TS_AND_VUE_FILES,
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': devSeverity(),
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          disallowTypeAnnotations: true,
          fixStyle: 'inline-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    name: 'uselab/typescript/tooling-files',
    files: ROOT_TOOLING_FILES,
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

export const typescript = (options: PresetOptions = {}): Config[] =>
  scopeConfigs(typescriptConfigs, options);
