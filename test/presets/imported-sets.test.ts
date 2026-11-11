import { describe, expect, it } from 'vitest';
import { configs } from '../../src/app';
import { configForFile, severityOf } from '../helpers';

/** Imported rule sets are not tested in depth: only that each set is active, via one known rule. */
describe('imported rule sets', () => {
  const all = [
    ...configs.javascript(),
    ...configs.typescript(),
    ...configs.vue(),
    ...configs.react(),
  ];

  it.each([
    ['@eslint/js recommended', 'src/a.js', 'no-undef'],
    ['eslint-plugin-import-x recommended', 'src/a.js', 'import-x/no-duplicates'],
    ['typescript-eslint recommended', 'src/a.ts', '@typescript-eslint/no-explicit-any'],
    ['eslint-plugin-vue flat/recommended', 'src/a.vue', 'vue/multi-word-component-names'],
    ['@eslint-react recommended (js)', 'src/a.jsx', '@eslint-react/no-missing-key'],
    ['@eslint-react recommended-typescript', 'src/a.tsx', '@eslint-react/no-missing-key'],
    ['eslint-plugin-react-hooks recommended', 'src/a.tsx', 'react-hooks/rules-of-hooks'],
  ])('%s is active', async (_label, file, rule) => {
    const resolved = await configForFile(all, file);
    expect(severityOf(resolved, rule)).toBeGreaterThan(0);
  });

  it('eslint-config-prettier turns off formatting rules', async () => {
    const resolved = await configForFile([...all, ...configs.prettier()], 'src/a.vue');
    expect(severityOf(resolved, 'vue/max-attributes-per-line')).toBe(0);
  });

  it('globals: node preset defines Node globals', async () => {
    const resolved = await configForFile([...configs.javascript(), ...configs.node()], 'src/a.js');
    expect(resolved.languageOptions?.globals).toHaveProperty('process');
  });

  it('globals: node({ ignores }) skips the ignored files', async () => {
    const config = [...configs.javascript(), ...configs.node({ ignores: ['src/**'] })];
    const resolved = await configForFile(config, 'src/a.js');
    expect(resolved.languageOptions?.globals ?? {}).not.toHaveProperty('process');
  });
});
