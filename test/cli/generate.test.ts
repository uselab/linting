import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_FILES,
  eslintConfigFile,
  generateEslintConfig,
  generatePrettierConfig,
  orderPresets,
  prettierConfigFile,
  type IgnoresAnswers,
  type InitAnswers,
} from '../../src/features/cli/generate';
import packageJson from '../../package.json';

const srcIndex = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'app',
  'index.ts',
);

/** The project's `eslint/config`, as the temporary test projects have no node_modules. */
const eslintConfigModule = createRequire(import.meta.url)
  .resolve('eslint/config')
  .replaceAll('\\', '/');

const DEFAULT_LINES = ["    '**/dist/**',", "    '**/node_modules/**',", "    '**/*.tsbuildinfo',"];

/** The patterns of the generated `globalIgnores([...])`, one per line, without comments. */
const ignoresBlock = (config: string): string[] => {
  const lines = config.split('\n');
  return lines
    .slice(lines.indexOf('  globalIgnores([') + 1, lines.indexOf('  ]),'))
    .map((line) => line.replace(/ \/\/ .*$/, ''));
};

describe('generateEslintConfig', () => {
  it('always starts with the global ignores and keeps the canonical order with prettier last', () => {
    const config = generateEslintConfig({
      presets: ['prettier', 'react', 'typescript', 'javascript', 'browser'],
    });
    expect(config).toBe(
      [
        "import { globalIgnores } from 'eslint/config';",
        "import { configs } from '@uselab/linting';",
        '',
        'export default [',
        '  globalIgnores([',
        ...DEFAULT_LINES,
        '  ]),',
        '  ...configs.javascript(),',
        '  ...configs.typescript(),',
        '  ...configs.react(),',
        '  ...configs.browser(),',
        '  ...configs.prettier(),',
        '];',
        '',
      ].join('\n'),
    );
  });

  it('places vueA11y right after vue', () => {
    const config = generateEslintConfig({ presets: ['prettier', 'vueA11y', 'react', 'vue'] });
    const spreadLines = config.split('\n').filter((line) => line.startsWith('  ...configs.'));
    expect(spreadLines).toEqual([
      '  ...configs.vue(),',
      '  ...configs.vueA11y(),',
      '  ...configs.react(),',
      '  ...configs.prettier(),',
    ]);
  });

  it.each<[IgnoresAnswers | undefined, string[]]>([
    [undefined, []],
    [{ mode: 'all', globs: ['legacy/**'] }, []],
    [{ mode: 'exclude', globs: [] }, []],
    [{ mode: 'exclude', globs: ['legacy/**', 'src/old/**'] }, ['legacy/**', 'src/old/**']],
    [
      { mode: 'only', globs: ['src/**', 'test/**'] },
      ['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', '!test/**'],
    ],
  ])('writes the lint scope %o before the defaults', (ignores, scope) => {
    const config = generateEslintConfig({ presets: ['javascript'], ignores });
    expect(ignoresBlock(config)).toEqual([
      ...scope.map((pattern) => `    '${pattern}',`),
      ...DEFAULT_LINES,
    ]);
  });

  it('explains the opt-in prefix with comments', () => {
    const config = generateEslintConfig({
      presets: ['javascript'],
      ignores: { mode: 'only', globs: ['src/**'] },
    });
    expect(config).toMatch(/^ {4}'\*\*\/\*', \/\/ \S/m);
    expect(config).toMatch(/^ {4}'!\*\*\/\*\/', \/\/ \S/m);
    expect(config).toMatch(/^ {4}'!\*\.\{js,mjs,cjs,ts,mts,cts\}', \/\/ \S/m);
    expect(config).toContain("    '!src/**',\n");
  });

  it('writes no comments outside opt-in mode', () => {
    const config = generateEslintConfig({
      presets: ['javascript'],
      ignores: { mode: 'exclude', globs: ['**/*'] },
    });
    expect(config).not.toContain('//');
  });

  it('calls boundaries without options when only defaults are chosen', () => {
    const config = generateEslintConfig({
      presets: ['javascript', 'boundaries'],
      boundaries: { srcDirs: ['src'] },
    });
    expect(config).toContain('  ...configs.boundaries(),');
  });

  it('emits the chosen boundaries options', () => {
    const config = generateEslintConfig({
      presets: ['boundaries', 'javascript'],
      boundaries: {
        tsconfig: 'tsconfig.app.json',
        srcDirs: ["packages/o'web/src", 'lib'],
      },
    });
    expect(config).toContain(
      String.raw`  ...configs.boundaries({ srcDirs: ['packages/o\'web/src', 'lib'], tsconfig: 'tsconfig.app.json' }),`,
    );
  });

  it('calls javascript without options for the default test file globs', () => {
    const config = generateEslintConfig({
      presets: ['javascript'],
      javascript: { testFiles: [...DEFAULT_TEST_FILES] },
    });
    expect(config).toContain('  ...configs.javascript(),');
  });

  it('emits the chosen test file globs', () => {
    const config = generateEslintConfig({
      presets: ['javascript'],
      javascript: { testFiles: ['**/*.test.ts', "e2e/o'k/**"] },
    });
    expect(config).toContain(
      String.raw`  ...configs.javascript({ testFiles: ['**/*.test.ts', 'e2e/o\'k/**'] }),`,
    );
  });

  it('emits an empty testFiles list when there are no test files', () => {
    const config = generateEslintConfig({ presets: ['javascript'], javascript: { testFiles: [] } });
    expect(config).toContain('  ...configs.javascript({ testFiles: [] }),');
  });

  it('removes duplicates in orderPresets', () => {
    expect(orderPresets(['vue', 'javascript', 'vue'])).toEqual(['javascript', 'vue']);
  });
});

describe('generatePrettierConfig', () => {
  it('spreads the shared prettier config exported by the package', () => {
    expect(generatePrettierConfig()).toBe(
      [
        "import type { Config } from 'prettier';",
        "import uselab from '@uselab/linting/prettier';",
        '',
        'const config: Config = {',
        '  ...uselab,',
        '  // add custom configuration here',
        '};',
        '',
        'export default config;',
        '',
      ].join('\n'),
    );
    expect(Object.keys(packageJson.exports)).toContain('./prettier');
  });
});

describe('prettierConfigFile', () => {
  it('uses .ts for "type": "module" packages and .mts otherwise', () => {
    expect(prettierConfigFile(true)).toBe('prettier.config.ts');
    expect(prettierConfigFile(false)).toBe('prettier.config.mts');
  });
});

describe('eslintConfigFile', () => {
  it('uses .ts for "type": "module" packages and .mts otherwise', () => {
    expect(eslintConfigFile(true)).toBe('eslint.config.ts');
    expect(eslintConfigFile(false)).toBe('eslint.config.mts');
  });
});

describe('generated ESLint config', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each<[boolean, InitAnswers]>([
    [false, { presets: ['javascript', 'node', 'prettier'] }],
    [true, { presets: ['javascript', 'typescript', 'vue', 'browser', 'aliases', 'prettier'] }],
    [
      false,
      {
        presets: ['javascript', 'typescript', 'react', 'browser', 'boundaries'],
        boundaries: { tsconfig: 'tsconfig.json', srcDirs: ['src'] },
      },
    ],
  ])('loads in ESLint (module package: %s): %o', async (isModule, answers) => {
    dir = mkdtempSync(path.join(tmpdir(), 'uselab-init-'));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(isModule ? { type: 'module' } : {}),
    );
    const content = generateEslintConfig(answers)
      .replace("'@uselab/linting'", JSON.stringify(srcIndex.replaceAll('\\', '/')))
      .replace("'eslint/config'", JSON.stringify(eslintConfigModule));
    const configFile = path.join(dir, eslintConfigFile(isModule));
    writeFileSync(configFile, content);
    const eslint = new ESLint({ cwd: dir, overrideConfigFile: configFile });
    const resolved = await eslint.calculateConfigForFile(path.join(dir, 'src', 'main.js'));
    expect(resolved.rules?.['no-alert']).toBeDefined();
    const restricted = resolved.rules?.['no-restricted-imports'];
    const severity = Array.isArray(restricted) ? restricted[0] : restricted;
    // the node preset (after aliases) turns the rule off for its files
    const active = answers.presets.includes('aliases') && !answers.presets.includes('node');
    expect(severity !== undefined && severity !== 0 && severity !== 'off').toBe(active);
  });
});
