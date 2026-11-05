import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addViteAliases,
  addViteChecker,
  checkViteAliases,
  findViteConfig,
  hasViteChecker,
  viteCheckerSnippet,
  viteConfigNeedsNodeTypes,
} from '../../src/features/cli/vite';

const VITE_TEMPLATE = [
  "import { defineConfig } from 'vite'",
  "import vue from '@vitejs/plugin-vue'",
  '',
  'export default defineConfig({',
  '  plugins: [vue()],',
  '})',
  '',
].join('\n');

const ALL = ['@app', '@features', '@support'];

/** Collapses whitespace so assertions don't depend on recast's line breaks. */
const flat = (code: string | undefined): string => (code ?? '').replaceAll(/\s+/g, ' ');

describe('findViteConfig', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uselab-vite-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the Vite config', () => {
    expect(findViteConfig(dir)).toBeUndefined();
    writeFileSync(path.join(dir, 'vite.config.mjs'), 'export default {};');
    expect(findViteConfig(dir)?.file).toBe('vite.config.mjs');
  });
});

describe('checkViteAliases', () => {
  it('reports all aliases missing for the Vite template', () => {
    expect(checkViteAliases(VITE_TEMPLATE)).toEqual({ supported: true, missing: ALL });
  });

  it('reports only the missing aliases', () => {
    const text = "export default { resolve: { alias: { '@features': '/x' } } };";
    expect(checkViteAliases(text)).toEqual({ supported: true, missing: ['@app', '@support'] });
  });

  it('marks function configs and array aliases as unsupported', () => {
    expect(checkViteAliases('export default defineConfig(() => ({}));').supported).toBe(false);
    expect(checkViteAliases('export default { resolve: { alias: [] } };').supported).toBe(false);
    expect(checkViteAliases('export default (').supported).toBe(false);
  });

  it('detects aliases in unsupported configs by text', () => {
    const text =
      "export default () => ({ resolve: { alias: { '@app': '', \"@features\": '' } } });";
    expect(checkViteAliases(text)).toEqual({ supported: false, missing: ['@support'] });
  });
});

describe('addViteAliases', () => {
  it('adds resolve.alias and the node:url import to the Vite template', () => {
    const code = addViteAliases(VITE_TEMPLATE);
    expect(code).toContain("import { fileURLToPath, URL } from 'node:url'");
    expect(code).toContain('plugins: [vue()],');
    expect(flat(code)).toContain(
      "'@app': fileURLToPath( new URL('./src/app', import.meta.url), ),",
    );
    expect(flat(code)).toContain("new URL('./src/features', import.meta.url)");
    expect(flat(code)).toContain("new URL('./src/support', import.meta.url)");
    expect(checkViteAliases(code ?? '').missing).toEqual([]);
  });

  it('handles a plain object export', () => {
    const code = addViteAliases('export default {};\n');
    expect(checkViteAliases(code ?? '').missing).toEqual([]);
  });

  it('merges into an existing resolve.alias and keeps other options', () => {
    const text = [
      "import { fileURLToPath } from 'node:url';",
      'export default {',
      "  resolve: { extensions: ['.ts'], alias: { '@app': '/custom', vue: 'vue/dist/vue.esm-bundler.js' } },",
      '};',
      '',
    ].join('\n');
    const code = addViteAliases(text);
    expect(code).toContain("'@app': '/custom'");
    expect(code).toContain("vue: 'vue/dist/vue.esm-bundler.js'");
    expect(code).toContain("extensions: ['.ts']");
    expect(flat(code)).toContain("new URL('./src/features', import.meta.url)");
    expect(code?.match(/from 'node:url'/g)).toHaveLength(1);
    expect(code).toContain('URL');
  });

  it('handles a config exported through a variable', () => {
    const text = [
      "import { defineConfig } from 'vite'",
      'const config = defineConfig({ plugins: [] })',
      'export default config',
      '',
    ].join('\n');
    expect(checkViteAliases(text)).toEqual({ supported: true, missing: ALL });
    const code = addViteAliases(text);
    expect(code).toContain('const config = defineConfig({');
    expect(checkViteAliases(code ?? '').missing).toEqual([]);
  });

  it('returns undefined for unsupported configs', () => {
    expect(addViteAliases('export default defineConfig(({ mode }) => ({}));')).toBeUndefined();
    expect(addViteAliases('export default { resolve: { alias: [] } };')).toBeUndefined();
    expect(
      addViteAliases("import config from './shared';\nexport default config;"),
    ).toBeUndefined();
  });
});

describe('viteConfigNeedsNodeTypes', () => {
  it.each([
    ['vite.config.ts', "import { fileURLToPath } from 'node:url';", true],
    ['vite.config.mts', 'import path from "path";', true],
    ['vite.config.ts', "const fs = await import('fs/promises');", true],
    ['vite.config.ts', VITE_TEMPLATE, false],
    ['vite.config.js', "import { fileURLToPath } from 'node:url';", false],
  ])('%s with %j ? %s', (file, text, expected) => {
    expect(viteConfigNeedsNodeTypes(file, text)).toBe(expected);
  });

  it('is true after adding the aliases to a TypeScript config', () => {
    expect(viteConfigNeedsNodeTypes('vite.config.ts', addViteAliases(VITE_TEMPLATE) ?? '')).toBe(
      true,
    );
  });
});

describe('addViteChecker', () => {
  it('adds checker() with vue-tsc and ESLint to the Vite template', () => {
    const code = addViteChecker(VITE_TEMPLATE, { vue: true, tsconfig: 'tsconfig.app.json' });
    expect(code).toContain("import checker from 'vite-plugin-checker'");
    expect(flat(code)).toContain('plugins: [vue(), checker({');
    expect(flat(code)).toContain("vueTsc: { tsconfigPath: 'tsconfig.app.json', },");
    expect(flat(code)).toContain("eslint: { lintCommand: 'eslint .', useFlatConfig: true, },");
    expect(flat(code)).toContain('enableBuild: true,');
    expect(hasViteChecker(code ?? '')).toBe(true);
  });

  it('uses typescript: true for the default tsconfig and creates plugins', () => {
    const code = addViteChecker('export default {};\n', { vue: false, tsconfig: 'tsconfig.json' });
    expect(flat(code)).toContain('plugins: [checker({ typescript: true,');
  });

  it('handles a config exported through a variable', () => {
    const text = 'const config = defineConfig({ plugins: [] })\nexport default config\n';
    expect(flat(addViteChecker(text, { vue: false }))).toContain(
      'const config = defineConfig({ plugins: [checker({',
    );
  });

  it('returns undefined for unsupported configs', () => {
    expect(addViteChecker('export default defineConfig(() => ({}));', { vue: false })).toBe(
      undefined,
    );
    expect(addViteChecker('export default { plugins: getPlugins() };', { vue: false })).toBe(
      undefined,
    );
  });

  it('prints a snippet for manual setup', () => {
    expect(viteCheckerSnippet({ vue: false })).toContain('  typescript: true,');
    expect(viteCheckerSnippet({ vue: false })).toContain('  enableBuild: true');
  });
});

describe('hasViteChecker', () => {
  it('detects the vite-plugin-checker import', () => {
    expect(hasViteChecker('import checker from "vite-plugin-checker";')).toBe(true);
    expect(hasViteChecker(VITE_TEMPLATE)).toBe(false);
  });
});
