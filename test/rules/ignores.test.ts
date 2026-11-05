import { globalIgnores } from 'eslint/config';
import { describe, expect, it } from 'vitest';
import { configs, DEFAULT_IGNORES } from '../../src/app';
import { isIgnored } from '../helpers';

const withIgnores = (scope: string[] = []) => [
  globalIgnores([...scope, ...DEFAULT_IGNORES]),
  ...configs.javascript(),
];

describe('globalIgnores() with DEFAULT_IGNORES', () => {
  const config = withIgnores();

  it.each([
    'dist/index.js',
    'packages/app/dist/index.js',
    'node_modules/pkg/index.js',
    'coverage/lcov-report/index.js',
    'tsconfig.app.tsbuildinfo',
  ])('ignores %s by default', async (file) => {
    expect(await isIgnored(config, file)).toBe(true);
  });

  it('does not ignore source files', async () => {
    expect(await isIgnored(config, 'src/index.js')).toBe(false);
  });

  it('adds extra patterns', async () => {
    const extra = withIgnores(['generated/**']);
    expect(await isIgnored(extra, 'generated/api.js')).toBe(true);
    expect(await isIgnored(extra, 'dist/index.js')).toBe(true);
    expect(await isIgnored(config, 'generated/api.js')).toBe(false);
  });

  describe('opt-in', () => {
    const optIn = withIgnores(['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**']);

    it.each(['src/index.js', 'src/deep/nested/file.js', 'eslint.config.js', 'vite.config.mts'])(
      'lints %s',
      async (file) => {
        expect(await isIgnored(optIn, file)).toBe(false);
      },
    );

    it.each([
      'legacy/old.js',
      'test/a.test.js',
      'packages/app/src/index.js',
      'src/dist/index.js',
      'src/coverage/index.js',
    ])('ignores %s', async (file) => {
      expect(await isIgnored(optIn, file)).toBe(true);
    });
  });
});
