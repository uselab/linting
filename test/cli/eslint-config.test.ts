import { describe, expect, it } from 'vitest';
import {
  readEslintConfig,
  updateEslintConfig,
  updateEslintIgnores,
} from '../../src/features/cli/eslint-config';
import {
  DEFAULT_TEST_FILES,
  generateEslintConfig,
  type IgnoresAnswers,
  type PresetId,
} from '../../src/features/cli/generate';

const DEFAULTS = "'**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo'";

const CUSTOM_CONFIG = [
  "import { globalIgnores } from 'eslint/config';",
  "import { javascriptPreset, boundariesPreset, prettierPreset } from '@uselab/linting';",
  "import local from './eslint.local.js';",
  '',
  'export default [',
  `  globalIgnores([${DEFAULTS}]),`,
  '  ...javascriptPreset(),',
  '  // project rules',
  "  { rules: { 'no-console': 'off' } },",
  '  ...local,',
  "  ...boundariesPreset({ tsconfig: 'tsconfig.app.json' }),",
  '  ...prettierPreset,',
  '];',
  '',
].join('\n');

/** Puts multi-line `globalIgnores([...])` calls on one line, so tests don't depend on formatting. */
const compact = (code: string | undefined): string =>
  (code ?? '').replaceAll(
    /(\w+)\(\[([^\]]*)\]\)/g,
    (_, name: string, inner: string) =>
      `${name}([${inner
        .replaceAll(/ \/\/ [^\n]*/g, '')
        .trim()
        .replaceAll(/\s*\n\s*/g, ' ')
        .replace(/,$/, '')}])`,
  );

/** Lines with a uselab spread or the global ignores, to check the order without formatting. */
const spreads = (code: string | undefined): string[] =>
  compact(code)
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        (line.startsWith('...') && line.includes('Preset')) || line.startsWith('globalIgnores('),
    );

describe('readEslintConfig', () => {
  it('reads presets and boundaries options of a generated config', () => {
    const text = generateEslintConfig({
      presets: ['javascript', 'typescript', 'boundaries', 'prettier'],
      boundaries: {
        srcDirs: ['apps/web/src', 'apps/admin/src'],
        tsconfig: ['apps/web/tsconfig.json', 'apps/admin/tsconfig.json'],
      },
    });
    expect(readEslintConfig(text)).toEqual({
      presets: ['javascript', 'typescript', 'boundaries', 'prettier'],
      javascript: { testFiles: [] },
      javascriptEditable: true,
      boundaries: {
        srcDirs: ['apps/web/src', 'apps/admin/src'],
        tsconfig: ['apps/web/tsconfig.json', 'apps/admin/tsconfig.json'],
      },
      boundariesEditable: true,
      queryEditable: true,
      browserEditable: true,
      nodeEditable: true,
      ignores: { mode: 'all', globs: [] },
      ignoresEditable: true,
    });
  });

  it('reads the vueA11y preset', () => {
    const text = generateEslintConfig({ presets: ['javascript', 'vue', 'vueA11y'] });
    expect(readEslintConfig(text)?.presets).toEqual(['javascript', 'vue', 'vueA11y']);
  });

  it('supports a renamed import and defineConfig([...])', () => {
    const text = [
      "import { defineConfig } from 'eslint/config';",
      "import { javascriptPreset as js, vuePreset as vue } from '@uselab/linting';",
      'export default defineConfig([...js, ...vue()]);',
    ].join('\n');
    expect(readEslintConfig(text)?.presets).toEqual(['javascript', 'vue']);
  });

  it('marks non-literal boundaries options as not editable', () => {
    const text = [
      "import { boundariesPreset } from '@uselab/linting';",
      'const tsconfig = "tsconfig.json";',
      'export default [...boundariesPreset({ tsconfig })];',
    ].join('\n');
    expect(readEslintConfig(text)).toMatchObject({
      presets: ['boundaries'],
      boundaries: undefined,
      boundariesEditable: false,
    });
  });

  it('returns undefined for other configs', () => {
    expect(readEslintConfig('export default [];')).toBeUndefined();
    expect(readEslintConfig("import js from '@eslint/js';\nexport default [js];")).toBeUndefined();
    expect(readEslintConfig('export default (')).toBeUndefined();
  });

  it('reads the test file globs of javascript()', () => {
    const text = generateEslintConfig({
      presets: ['javascript'],
      javascript: { testFiles: ['e2e/**', '**/*.test.ts'] },
    });
    expect(readEslintConfig(text)).toMatchObject({
      javascript: { testFiles: ['e2e/**', '**/*.test.ts'] },
      javascriptEditable: true,
    });
  });

  it('marks non-literal javascript options as not editable', () => {
    const text = [
      "import { javascriptPreset } from '@uselab/linting';",
      "const testFiles = ['e2e/**'];",
      'export default [...javascriptPreset({ testFiles })];',
    ].join('\n');
    expect(readEslintConfig(text)).toMatchObject({
      javascript: undefined,
      javascriptEditable: false,
    });
  });
});

describe('updateEslintConfig', () => {
  it('adds and removes presets in canonical order and keeps custom entries', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'typescript', 'vue', 'node', 'prettier'],
    });
    expect(update).toMatchObject({
      added: ['typescript', 'vue', 'node'],
      removed: ['boundaries'],
      boundariesUpdated: false,
    });
    expect(update?.code).toContain('// project rules');
    expect(update?.code).toContain("{ rules: { 'no-console': 'off' } },");
    expect(update?.code).toContain('...local,');
    expect(update?.code).toContain("import local from './eslint.local.js';");
    expect(spreads(update?.code)).toEqual([
      `globalIgnores([${DEFAULTS}]),`,
      '...javascriptPreset(),',
      '...typescriptPreset(),',
      '...vuePreset(),',
      '...nodePreset(),',
      '...prettierPreset,',
    ]);
  });

  it('adds and removes the matching imports', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'typescript', 'prettier'],
    });
    const [importLine] =
      (update?.code ?? '').match(/import \{[^}]*\} from '@uselab\/linting';/) ?? [];
    expect(importLine).toContain('typescriptPreset');
    expect(importLine).toContain('javascriptPreset');
    expect(importLine).toContain('prettierPreset');
    expect(importLine).not.toContain('boundariesPreset');
  });

  it('rewrites changed boundaries options', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      boundaries: { tsconfig: 'tsconfig.json', srcDirs: ['src'] },
    });
    expect(update?.boundariesUpdated).toBe(true);
    expect(update?.code).toContain("...boundariesPreset({ tsconfig: 'tsconfig.json' }),");
  });

  it('returns the text unchanged when the presets match', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      boundaries: { tsconfig: 'tsconfig.app.json', srcDirs: ['src'] },
    });
    expect(update).toEqual({
      code: CUSTOM_CONFIG,
      added: [],
      removed: [],
      javascriptUpdated: false,
      boundariesUpdated: false,
      queryUpdated: false,
      globalsUpdated: [],
      ignoresUpdated: false,
    });
  });

  it('appends after the last uselab entry when no later preset exists', () => {
    const text = generateEslintConfig({ presets: ['javascript'] });
    const update = updateEslintConfig(text, { presets: ['javascript', 'boundaries'] });
    expect(spreads(update?.code)).toEqual([
      `globalIgnores([${DEFAULTS}]),`,
      '...javascriptPreset(),',
      '...boundariesPreset(),',
    ]);
  });

  it('returns undefined for configs without @uselab/linting', () => {
    expect(updateEslintConfig('export default [];', { presets: ['javascript'] })).toBeUndefined();
  });

  it('rewrites changed test file globs', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      javascript: { testFiles: ['e2e/**'] },
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update).toMatchObject({ javascriptUpdated: true, boundariesUpdated: false });
    expect(update?.code).toContain("...javascriptPreset({ testFiles: ['e2e/**'] }),");
  });

  it('keeps javascript() when there are no test files', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      javascript: { testFiles: [] },
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update?.javascriptUpdated).toBe(false);
  });

  it('writes the default test file globs explicitly', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      javascript: { testFiles: [...DEFAULT_TEST_FILES] },
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update?.code).toContain("...javascriptPreset({ testFiles: ['test/**'] }),");
  });

  it('leaves non-literal javascript options unchanged', () => {
    const text = CUSTOM_CONFIG.replace(
      '...javascriptPreset(),',
      '...javascriptPreset({ testFiles: local.testFiles }),',
    );
    const update = updateEslintConfig(text, {
      presets: ['javascript', 'boundaries', 'prettier'],
      javascript: { testFiles: ['e2e/**'] },
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update).toMatchObject({ javascriptUpdated: false, code: text });
  });
});

describe('browser() / node()', () => {
  const BROWSER = {
    presets: ['javascript', 'browser', 'node'] satisfies PresetId[],
    environment: { type: 'browser' as const, browserFiles: ['src/**', 'apps/web/src/**'] },
  };
  const NODE = {
    presets: ['javascript', 'node'] satisfies PresetId[],
    environment: { type: 'node' as const, browserFiles: [] },
  };
  const BROWSER_SPREADS = [
    "...browserPreset({ files: ['src/**', 'apps/web/src/**'] }),",
    "...nodePreset({ ignores: ['src/**', 'apps/web/src/**'] }),",
  ];

  it('generates scoped globals for a browser project and node() for a Node project', () => {
    expect(spreads(generateEslintConfig(BROWSER)).slice(2)).toEqual(BROWSER_SPREADS);
    expect(spreads(generateEslintConfig(NODE)).slice(2)).toEqual(['...nodePreset(),']);
  });

  it('reads the globs and the project type', () => {
    expect(readEslintConfig(generateEslintConfig(BROWSER))).toMatchObject({
      browserFiles: ['src/**', 'apps/web/src/**'],
      nodeIgnores: ['src/**', 'apps/web/src/**'],
      environment: BROWSER.environment,
    });
    expect(readEslintConfig(generateEslintConfig(NODE))).toMatchObject({
      browserFiles: undefined,
      nodeIgnores: undefined,
      environment: { type: 'node', browserFiles: [] },
    });
  });

  it('rewrites changed browser globs', () => {
    const text = generateEslintConfig(BROWSER);
    const answers = {
      ...BROWSER,
      environment: { type: 'browser' as const, browserFiles: ['web/**'] },
    };
    const update = updateEslintConfig(text, answers);
    expect(update?.globalsUpdated).toEqual(['browser', 'node']);
    expect(spreads(update?.code).slice(2)).toEqual([
      "...browserPreset({ files: ['web/**'] }),",
      "...nodePreset({ ignores: ['web/**'] }),",
    ]);
    expect(updateEslintConfig(text, BROWSER)?.code).toBe(text);
  });

  it('switches between a browser and a Node project', () => {
    const toNode = updateEslintConfig(generateEslintConfig(BROWSER), NODE);
    expect(toNode).toMatchObject({ removed: ['browser'], globalsUpdated: ['node'] });
    expect(spreads(toNode?.code).slice(2)).toEqual(['...nodePreset(),']);

    const toBrowser = updateEslintConfig(generateEslintConfig(NODE), BROWSER);
    expect(toBrowser).toMatchObject({ added: ['browser'], globalsUpdated: ['node'] });
    expect(spreads(toBrowser?.code).slice(2)).toEqual(BROWSER_SPREADS);
  });

  it('leaves non-literal options unchanged', () => {
    const text = [
      "import { javascriptPreset, browserPreset, nodePreset } from '@uselab/linting';",
      "const files = ['src/**'];",
      'export default [',
      '  ...javascriptPreset(),',
      '  ...browserPreset({ files }),',
      '  ...nodePreset({ ignores: files }),',
      '];',
    ].join('\n');
    expect(readEslintConfig(text)).toMatchObject({ browserEditable: false, nodeEditable: false });
    expect(updateEslintConfig(text, BROWSER)).toMatchObject({ globalsUpdated: [], code: text });
  });
});

describe('globalIgnores()', () => {
  const PRESETS: { presets: PresetId[] } = { presets: ['javascript', 'boundaries', 'prettier'] };
  const BOUNDARIES = { boundaries: { tsconfig: 'tsconfig.app.json' } };
  const DEFAULT_ENTRY = `globalIgnores([${DEFAULTS}]),`;
  const withIgnores = (args: string): string => CUSTOM_CONFIG.replace(DEFAULT_ENTRY, args);
  const withScope = (scope: string): string =>
    withIgnores(`globalIgnores([${scope}, ${DEFAULTS}]),`);

  it.each<[string, IgnoresAnswers]>([
    [`globalIgnores([${DEFAULTS}]),`, { mode: 'all', globs: [] }],
    ['globalIgnores([]),', { mode: 'all', globs: [] }],
    [`globalIgnores([${DEFAULTS}], 'ignores'),`, { mode: 'all', globs: [] }],
    ["globalIgnores(['legacy/**']),", { mode: 'exclude', globs: ['legacy/**'] }],
    [
      `globalIgnores(['legacy/**', 'src/old/**', ${DEFAULTS}]),`,
      { mode: 'exclude', globs: ['legacy/**', 'src/old/**'] },
    ],
    [
      `globalIgnores(['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', '!test/**', ${DEFAULTS}]),`,
      { mode: 'only', globs: ['src/**', 'test/**'] },
    ],
    [
      `globalIgnores(['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', 'src/legacy/**', ${DEFAULTS}]),`,
      { mode: 'only', globs: ['src/**', '!src/legacy/**'] },
    ],
  ])('reads %s', (entry, ignores) => {
    expect(readEslintConfig(withIgnores(entry))).toMatchObject({ ignores, ignoresEditable: true });
  });

  it('reads a renamed globalIgnores import', () => {
    const text = withScope("'legacy/**'")
      .replace('import { globalIgnores }', 'import { globalIgnores as ignore }')
      .replace('globalIgnores([', 'ignore([');
    expect(readEslintConfig(text)?.ignores).toEqual({ mode: 'exclude', globs: ['legacy/**'] });
    const update = updateEslintConfig(text, {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'exclude', globs: ['other/**'] },
    });
    expect(compact(update?.code)).toContain(`ignore(['other/**', ${DEFAULTS}]),`);
  });

  it.each([
    'globalIgnores(patterns),',
    `globalIgnores(['**/*', '!**/*/', 'legacy/**', '!src/**', ${DEFAULTS}]),`,
    `globalIgnores(['**/*', '!**/*/', '!src/**', 'src/legacy/**', '!src/legacy/keep/**', ${DEFAULTS}]),`,
    `globalIgnores(['**/*', '!**/*/', ${DEFAULTS}]),`,
  ])('marks %s as not editable and leaves it unchanged', (entry) => {
    const text = withIgnores(entry);
    expect(readEslintConfig(text)).toMatchObject({ ignores: undefined, ignoresEditable: false });
    const update = updateEslintConfig(text, {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'exclude', globs: ['legacy/**'] },
    });
    expect(update).toMatchObject({ ignoresUpdated: false, code: text });
  });

  it.each<[IgnoresAnswers, string]>([
    [{ mode: 'exclude', globs: ['legacy/**'] }, `globalIgnores(['legacy/**', ${DEFAULTS}]),`],
    [
      { mode: 'only', globs: ['src/**'] },
      `globalIgnores(['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', ${DEFAULTS}]),`,
    ],
    [
      { mode: 'only', globs: ['src/**', 'test/**', '!src/legacy/**'] },
      `globalIgnores(['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', '!test/**', 'src/legacy/**', ${DEFAULTS}]),`,
    ],
  ])('rewrites the lint scope %o', (ignores, expected) => {
    const update = updateEslintConfig(CUSTOM_CONFIG, { ...PRESETS, ...BOUNDARIES, ignores });
    expect(update).toMatchObject({ ignoresUpdated: true });
    expect(spreads(update?.code)[0]).toBe(expected);
    expect(readEslintConfig(update?.code ?? '')?.ignores).toEqual(ignores);
  });

  it('explains the opt-in prefix with comments when rewriting', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'only', globs: ['src/**'] },
    });
    expect(update?.code).toMatch(/^ {4}'\*\*\/\*', \/\/ \S/m);
    expect(update?.code).toMatch(/'!\*\*\/\*\/', \/\/ \S/);
  });

  it('resets the scope to all files', () => {
    const update = updateEslintConfig(withScope("'legacy/**'"), {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'all', globs: [] },
    });
    expect(update?.ignoresUpdated).toBe(true);
    expect(spreads(update?.code)[0]).toBe(DEFAULT_ENTRY);
  });

  it('keeps the scope when the answers match or are not given', () => {
    const text = withScope("'legacy/**'");
    const answers = { ...PRESETS, ...BOUNDARIES };
    expect(updateEslintConfig(text, answers)?.code).toBe(text);
    expect(
      updateEslintConfig(text, { ...answers, ignores: { mode: 'exclude', globs: ['legacy/**'] } })
        ?.code,
    ).toBe(text);
  });

  it('keeps defaults the developer removed while the scope is unchanged', () => {
    const text = withIgnores("globalIgnores(['legacy/**', '**/dist/**']),");
    const update = updateEslintConfig(text, {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'exclude', globs: ['legacy/**'] },
    });
    expect(update?.code).toBe(text);
  });

  it('inserts globalIgnores() and its import at the top when it is missing', () => {
    const text = CUSTOM_CONFIG.replace(`  ${DEFAULT_ENTRY}\n`, '').replace(
      "import { globalIgnores } from 'eslint/config';\n",
      '',
    );
    const update = updateEslintConfig(text, {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'exclude', globs: ['legacy/**'] },
    });
    expect(update?.ignoresUpdated).toBe(true);
    expect(update?.code).toContain("import { globalIgnores } from 'eslint/config';");
    expect(spreads(update?.code)[0]).toBe(`globalIgnores(['legacy/**', ${DEFAULTS}]),`);
    expect(
      updateEslintConfig(text, { ...PRESETS, ...BOUNDARIES, ignores: { mode: 'all', globs: [] } }),
    ).toMatchObject({ ignoresUpdated: false, code: text });
  });
});

describe('updateEslintIgnores', () => {
  const DEFAULT_ENTRY = `globalIgnores([${DEFAULTS}]),`;

  it('rewrites only the lint scope, keeping the presets and other entries', () => {
    const ignores: IgnoresAnswers = { mode: 'exclude', globs: ['legacy/**'] };
    const update = updateEslintIgnores(CUSTOM_CONFIG, ignores);
    expect(update?.updated).toBe(true);
    expect(spreads(update?.code)).toEqual([
      `globalIgnores(['legacy/**', ${DEFAULTS}]),`,
      '...javascriptPreset(),',
      "...boundariesPreset({ tsconfig: 'tsconfig.app.json' }),",
      '...prettierPreset,',
    ]);
    expect(update?.code).toContain('...local,');
    expect(readEslintConfig(update?.code ?? '')?.ignores).toEqual(ignores);
  });

  it('inserts globalIgnores() and its import when it is missing', () => {
    const text = CUSTOM_CONFIG.replace(`  ${DEFAULT_ENTRY}\n`, '').replace(
      "import { globalIgnores } from 'eslint/config';\n",
      '',
    );
    const update = updateEslintIgnores(text, { mode: 'only', globs: ['src/**'] });
    expect(update?.updated).toBe(true);
    expect(update?.code).toContain("import { globalIgnores } from 'eslint/config';");
  });

  it('leaves an unchanged scope alone', () => {
    expect(updateEslintIgnores(CUSTOM_CONFIG, { mode: 'all', globs: [] })).toEqual({
      code: CUSTOM_CONFIG,
      updated: false,
    });
  });

  it('returns undefined for non-literal ignores and other configs', () => {
    const ignores: IgnoresAnswers = { mode: 'exclude', globs: ['legacy/**'] };
    const text = CUSTOM_CONFIG.replace(DEFAULT_ENTRY, 'globalIgnores(patterns),');
    expect(updateEslintIgnores(text, ignores)).toBeUndefined();
    expect(updateEslintIgnores('export default [];\n', ignores)).toBeUndefined();
  });
});
