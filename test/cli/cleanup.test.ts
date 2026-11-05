import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findExistingTooling,
  isRemovableDependency,
  removeFromPackageJson,
} from '../../src/features/cli/cleanup';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-cleanup-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isRemovableDependency', () => {
  it.each([
    '@eslint/js',
    'eslint-plugin-vue',
    'eslint-config-prettier',
    'eslint-import-resolver-typescript',
    '@vue/eslint-config-typescript',
    '@typescript-eslint/parser',
    'typescript-eslint',
    'vue-eslint-parser',
    '@rushstack/eslint-patch',
    '@stylistic/eslint-plugin',
    '@eslint-react/eslint-plugin',
    'prettier-plugin-tailwindcss',
    '@trivago/prettier-plugin-sort-imports',
    '@prettier/plugin-xml',
    '@biomejs/biome',
    'tslint',
    'tslint-config-prettier',
    'standard',
    'ts-standard',
    'xo',
    'oxlint',
    'dprint',
  ])('removes %s', (name) => {
    expect(isRemovableDependency(name)).toBe(true);
  });

  it.each([
    'eslint',
    'prettier',
    'jiti',
    'typescript',
    'globals',
    '@uselab/linting',
    'vue',
    'stylelint',
  ])('keeps %s', (name) => {
    expect(isRemovableDependency(name)).toBe(false);
  });
});

describe('findExistingTooling', () => {
  it('finds config files, package.json keys and packages, except the kept files', () => {
    for (const file of [
      'eslint.config.js',
      'eslint.config.ts',
      '.eslintrc.cjs',
      '.eslintignore',
      '.prettierrc',
      '.prettierrc.json',
      'prettier.config.ts',
      '.prettierignore',
      'biome.json',
    ]) {
      writeFileSync(path.join(dir, file), '');
    }
    const report = findExistingTooling(
      dir,
      {
        prettier: {},
        eslintConfig: {},
        dependencies: { vue: '^3.0.0', 'eslint-plugin-vue': '^9.0.0' },
        devDependencies: { eslint: '^9.0.0', '@biomejs/biome': '^2.0.0' },
      },
      ['eslint.config.ts', 'prettier.config.ts'],
    );
    expect(report.files).toEqual([
      'eslint.config.js',
      '.eslintrc.cjs',
      '.eslintignore',
      '.prettierrc',
      '.prettierrc.json',
      'biome.json',
    ]);
    expect(report.packageJsonKeys).toEqual(['eslintConfig', 'prettier']);
    expect(report.dependencies).toEqual([
      { field: 'dependencies', name: 'eslint-plugin-vue' },
      { field: 'devDependencies', name: '@biomejs/biome' },
    ]);
  });
});

describe('removeFromPackageJson', () => {
  it('removes keys and packages, preserving formatting', () => {
    const text = [
      '{',
      '    "name": "app",',
      '    "prettier": { "semi": false },',
      '    "devDependencies": {',
      '        "eslint": "^9.0.0",',
      '        "eslint-plugin-vue": "^9.0.0"',
      '    }',
      '}',
      '',
    ].join('\n');
    const result = removeFromPackageJson(text, {
      files: [],
      packageJsonKeys: ['prettier'],
      dependencies: [{ field: 'devDependencies', name: 'eslint-plugin-vue' }],
    });
    expect(JSON.parse(result)).toEqual({ name: 'app', devDependencies: { eslint: '^9.0.0' } });
    expect(result).toContain('\n        "eslint": "^9.0.0"');
  });
});
