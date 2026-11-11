import { describe, expect, it } from 'vitest';
import { configs, type Config } from '../../src/app';
import { scopeConfigs } from '../../src/support/shared';
import { configForFile, severityOf } from '../helpers';

const presets: [string, (options?: { files?: string[]; ignores?: string[] }) => Config[]][] = [
  ['javascript', configs.javascript],
  ['typescript', configs.typescript],
  ['vue', configs.vue],
  ['vueA11y', configs.vueA11y],
  ['react', configs.react],
  ['query', configs.query],
  ['browser', configs.browser],
  ['node', configs.node],
  ['aliases', configs.aliases],
  ['boundaries', configs.boundaries],
  ['prettier', configs.prettier],
];

describe('preset options', () => {
  it.each(presets)('%s accepts files and ignores', (_name, preset) => {
    const blocks = preset({ files: ['src/**'], ignores: ['src/legacy/**'] });
    expect(blocks.length).toBeGreaterThan(0);
  });
});

describe('scopeConfigs', () => {
  it('returns the configs unchanged without options', () => {
    const blocks: Config[] = [{ files: ['**/*.ts'], rules: {} }];
    expect(scopeConfigs(blocks, {})).toBe(blocks);
  });

  it('intersects files with the own files of a block and adds them to blocks without', () => {
    const scoped = scopeConfigs([{ files: ['**/*.ts', '**/*.vue'], rules: {} }, { rules: {} }], {
      files: ['src/**'],
    });
    expect(scoped).toEqual([
      {
        files: [
          ['**/*.ts', 'src/**'],
          ['**/*.vue', 'src/**'],
        ],
        rules: {},
      },
      { files: ['src/**'], rules: {} },
    ]);
  });

  it('adds ignores to the own ignores', () => {
    const scoped = scopeConfigs([{ ignores: ['a/**'], rules: {} }], { ignores: ['b/**'] });
    expect(scoped[0]?.ignores).toEqual(['a/**', 'b/**']);
  });
});

describe('files and ignores in ESLint', () => {
  const FILE = 'src/a.ts';

  it('limits a preset to files matching both its own globs and `files`', async () => {
    const config = [...configs.typescript({ files: ['src/**'] })];
    const inside = await configForFile(config, FILE);
    const outside = await configForFile(config, 'lib/a.ts');
    expect(severityOf(inside, '@typescript-eslint/consistent-type-definitions')).toBe(2);
    expect(severityOf(outside, '@typescript-eslint/consistent-type-definitions')).toBeUndefined();
  });

  it('excludes `ignores` from a preset', async () => {
    const config = [...configs.typescript({ ignores: ['src/legacy/**'] })];
    const kept = await configForFile(config, FILE);
    const skipped = await configForFile(config, 'src/legacy/a.ts');
    expect(severityOf(kept, '@typescript-eslint/consistent-type-definitions')).toBe(2);
    expect(severityOf(skipped, '@typescript-eslint/consistent-type-definitions')).toBeUndefined();
  });
});
