import { describe, expect, it } from 'vitest';
import { configs } from '../../src';
import { isIgnored } from '../helpers';

describe('ignores()', () => {
  const config = [...configs.ignores(), ...configs.javascript];

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
    const extra = [...configs.ignores(['generated/**']), ...configs.javascript];
    expect(await isIgnored(extra, 'generated/api.js')).toBe(true);
    expect(await isIgnored(extra, 'dist/index.js')).toBe(true);
    expect(await isIgnored(config, 'generated/api.js')).toBe(false);
  });
});
