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
  "import { configs as uselab } from '@uselab/linting';",
  "import local from './eslint.local.js';",
  '',
  'export default [',
  `  globalIgnores([${DEFAULTS}]),`,
  '  ...uselab.javascript(),',
  '  // project rules',
  "  { rules: { 'no-console': 'off' } },",
  '  ...local,',
  "  ...uselab.boundaries({ tsconfig: 'tsconfig.app.json' }),",
  '  ...uselab.prettier,',
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
        line.startsWith('...uselab.') ||
        line.startsWith('...configs.') ||
        line.startsWith('globalIgnores('),
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
      javascript: {},
      javascriptEditable: true,
      javascriptLegacy: false,
      boundaries: {
        srcDirs: ['apps/web/src', 'apps/admin/src'],
        tsconfig: ['apps/web/tsconfig.json', 'apps/admin/tsconfig.json'],
      },
      boundariesEditable: true,
      boundariesRemovedOptions: [],
      browserEditable: true,
      browserLegacy: false,
      nodeEditable: true,
      nodeLegacy: false,
      ignores: { mode: 'all', globs: [] },
      ignoresEditable: true,
      ignoresLegacy: false,
    });
  });

  it('reads the vueA11y preset', () => {
    const text = generateEslintConfig({ presets: ['javascript', 'vue', 'vueA11y'] });
    expect(readEslintConfig(text)?.presets).toEqual(['javascript', 'vue', 'vueA11y']);
  });

  it('supports a renamed import and defineConfig([...])', () => {
    const text = [
      "import { defineConfig } from 'eslint/config';",
      "import { configs as c } from '@uselab/linting';",
      'export default defineConfig([...c.javascript, ...c.vue]);',
    ].join('\n');
    expect(readEslintConfig(text)?.presets).toEqual(['javascript', 'vue']);
  });

  it('marks non-literal boundaries options as not editable', () => {
    const text = [
      "import { configs } from '@uselab/linting';",
      'const tsconfig = "tsconfig.json";',
      'export default [...configs.boundaries({ tsconfig })];',
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
      javascriptLegacy: false,
    });
  });

  it('marks the ...configs.javascript spread of older versions as legacy', () => {
    const text =
      "import { configs } from '@uselab/linting';\nexport default [...configs.javascript];";
    expect(readEslintConfig(text)).toMatchObject({
      javascript: {},
      javascriptEditable: true,
      javascriptLegacy: true,
    });
  });

  it('marks non-literal javascript options as not editable', () => {
    const text = [
      "import { configs } from '@uselab/linting';",
      "const testFiles = ['e2e/**'];",
      'export default [...configs.javascript({ testFiles })];',
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
      '...uselab.javascript(),',
      '...uselab.typescript,',
      '...uselab.vue,',
      '...uselab.node(),',
      '...uselab.prettier,',
    ]);
  });

  it('rewrites changed boundaries options', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      boundaries: { tsconfig: 'tsconfig.json', srcDirs: ['src'] },
    });
    expect(update?.boundariesUpdated).toBe(true);
    expect(update?.code).toContain("...uselab.boundaries({ tsconfig: 'tsconfig.json' }),");
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
      globalsUpdated: [],
      ignoresUpdated: false,
      ignoresMigrated: false,
      boundariesRemovedOptions: [],
    });
  });

  it('appends after the last uselab entry when no later preset exists', () => {
    const text = generateEslintConfig({ presets: ['javascript'] });
    const update = updateEslintConfig(text, { presets: ['javascript', 'boundaries'] });
    expect(spreads(update?.code)).toEqual([
      `globalIgnores([${DEFAULTS}]),`,
      '...configs.javascript(),',
      '...configs.boundaries(),',
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
    expect(update?.code).toContain("...uselab.javascript({ testFiles: ['e2e/**'] }),");
  });

  it('keeps javascript() when the default test file globs are chosen', () => {
    const update = updateEslintConfig(CUSTOM_CONFIG, {
      presets: ['javascript', 'boundaries', 'prettier'],
      javascript: { testFiles: [...DEFAULT_TEST_FILES] },
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update?.javascriptUpdated).toBe(false);
  });

  it('migrates the ...configs.javascript spread of older versions', () => {
    const text = CUSTOM_CONFIG.replace('...uselab.javascript(),', '...uselab.javascript,');
    const update = updateEslintConfig(text, {
      presets: ['javascript', 'boundaries', 'prettier'],
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update?.javascriptUpdated).toBe(true);
    expect(spreads(update?.code)).toContain('...uselab.javascript(),');
  });

  it('leaves non-literal javascript options unchanged', () => {
    const text = CUSTOM_CONFIG.replace(
      '...uselab.javascript(),',
      '...uselab.javascript({ testFiles: local.testFiles }),',
    );
    const update = updateEslintConfig(text, {
      presets: ['javascript', 'boundaries', 'prettier'],
      javascript: { testFiles: ['e2e/**'] },
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update).toMatchObject({ javascriptUpdated: false, code: text });
  });

  it('drops boundaries options that no longer exist', () => {
    const text = CUSTOM_CONFIG.replace(
      "boundaries({ tsconfig: 'tsconfig.app.json' })",
      "boundaries({ tsconfig: 'tsconfig.app.json', include: ['src/**'], elements: [{ type: 'x' }] })",
    );
    expect(readEslintConfig(text)).toMatchObject({
      boundaries: { tsconfig: 'tsconfig.app.json' },
      boundariesEditable: true,
      boundariesRemovedOptions: ['include', 'elements'],
    });
    const update = updateEslintConfig(text, {
      presets: ['javascript', 'boundaries', 'prettier'],
      boundaries: { tsconfig: 'tsconfig.app.json' },
    });
    expect(update).toMatchObject({
      boundariesUpdated: true,
      boundariesRemovedOptions: ['include', 'elements'],
    });
    expect(update?.code).toContain("...uselab.boundaries({ tsconfig: 'tsconfig.app.json' }),");
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
    "...configs.browser({ files: ['src/**', 'apps/web/src/**'] }),",
    "...configs.node({ ignores: ['src/**', 'apps/web/src/**'] }),",
  ];

  it('generates scoped globals for a browser project and node() for a Node project', () => {
    expect(spreads(generateEslintConfig(BROWSER)).slice(2)).toEqual(BROWSER_SPREADS);
    expect(spreads(generateEslintConfig(NODE)).slice(2)).toEqual(['...configs.node(),']);
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

  it('migrates the ...configs.browser / ...configs.node spreads of older versions', () => {
    const text = [
      "import { configs } from '@uselab/linting';",
      'export default [',
      '  ...configs.javascript(),',
      '  ...configs.browser,',
      '  ...configs.node,',
      '];',
    ].join('\n');
    expect(readEslintConfig(text)).toMatchObject({
      browserLegacy: true,
      nodeLegacy: true,
      environment: { type: 'browser', browserFiles: [] },
    });
    const update = updateEslintConfig(text, BROWSER);
    expect(update?.globalsUpdated).toEqual(['browser', 'node']);
    expect(spreads(update?.code)).toEqual(['...configs.javascript(),', ...BROWSER_SPREADS]);
  });

  it('migrates legacy spreads even when the project type is not asked', () => {
    const text = [
      "import { configs } from '@uselab/linting';",
      'export default [',
      '  ...configs.javascript(),',
      '  ...configs.node,',
      '];',
    ].join('\n');
    const update = updateEslintConfig(text, { presets: ['javascript', 'node'] });
    expect(spreads(update?.code)).toEqual(['...configs.javascript(),', '...configs.node(),']);
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
      "...configs.browser({ files: ['web/**'] }),",
      "...configs.node({ ignores: ['web/**'] }),",
    ]);
    expect(updateEslintConfig(text, BROWSER)?.code).toBe(text);
  });

  it('switches between a browser and a Node project', () => {
    const toNode = updateEslintConfig(generateEslintConfig(BROWSER), NODE);
    expect(toNode).toMatchObject({ removed: ['browser'], globalsUpdated: ['node'] });
    expect(spreads(toNode?.code).slice(2)).toEqual(['...configs.node(),']);

    const toBrowser = updateEslintConfig(generateEslintConfig(NODE), BROWSER);
    expect(toBrowser).toMatchObject({ added: ['browser'], globalsUpdated: ['node'] });
    expect(spreads(toBrowser?.code).slice(2)).toEqual(BROWSER_SPREADS);
  });

  it('leaves non-literal options unchanged', () => {
    const text = [
      "import { configs } from '@uselab/linting';",
      "const files = ['src/**'];",
      'export default [',
      '  ...configs.javascript(),',
      '  ...configs.browser({ files }),',
      '  ...configs.node({ ignores: files }),',
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
    expect(readEslintConfig(withIgnores(entry))).toMatchObject({
      ignores,
      ignoresEditable: true,
      ignoresLegacy: false,
    });
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
    expect(update).toMatchObject({ ignoresUpdated: true, ignoresMigrated: false });
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

  it.each<[string, IgnoresAnswers]>([
    [`'legacy/**', ${DEFAULTS}, '**/coverage/**'`, { mode: 'exclude', globs: ['legacy/**'] }],
    [
      `'**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', '**/dist/**', '**/coverage/**', '**/node_modules/**'`,
      { mode: 'only', globs: ['src/**'] },
    ],
  ])('reads the former **/coverage/** default as a default in %s', (patterns, ignores) => {
    const text = withIgnores(`globalIgnores([${patterns}]),`);
    expect(readEslintConfig(text)).toMatchObject({ ignores, ignoresEditable: true });
    expect(updateEslintConfig(text, { ...PRESETS, ...BOUNDARIES, ignores })?.code).toBe(text);
  });

  it('drops the former **/coverage/** default when rewriting the scope', () => {
    const text = withIgnores(`globalIgnores(['legacy/**', '**/coverage/**', ${DEFAULTS}]),`);
    const update = updateEslintConfig(text, {
      ...PRESETS,
      ...BOUNDARIES,
      ignores: { mode: 'exclude', globs: ['other/**'] },
    });
    expect(spreads(update?.code)[0]).toBe(`globalIgnores(['other/**', ${DEFAULTS}]),`);
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
      '...uselab.javascript(),',
      "...uselab.boundaries({ tsconfig: 'tsconfig.app.json' }),",
      '...uselab.prettier,',
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

describe('legacy configs.ignores()', () => {
  const PRESETS: { presets: PresetId[] } = { presets: ['javascript', 'boundaries', 'prettier'] };
  const BOUNDARIES = { boundaries: { tsconfig: 'tsconfig.app.json' } };
  const withLegacy = (args: string): string =>
    CUSTOM_CONFIG.replace("import { globalIgnores } from 'eslint/config';\n", '').replace(
      `globalIgnores([${DEFAULTS}]),`,
      `...uselab.ignores(${args}),`,
    );

  it.each<[string, IgnoresAnswers]>([
    ['', { mode: 'all', globs: [] }],
    ['[]', { mode: 'all', globs: [] }],
    ["['legacy/**', 'src/old/**']", { mode: 'exclude', globs: ['legacy/**', 'src/old/**'] }],
    [
      "['**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', '!test/**']",
      { mode: 'only', globs: ['src/**', 'test/**'] },
    ],
  ])('reads ignores(%s) and migrates it to globalIgnores()', (args, ignores) => {
    const text = withLegacy(args);
    expect(readEslintConfig(text)).toMatchObject({
      ignores,
      ignoresEditable: true,
      ignoresLegacy: true,
    });
    const update = updateEslintConfig(text, { ...PRESETS, ...BOUNDARIES, ignores });
    expect(update).toMatchObject({ ignoresUpdated: true, ignoresMigrated: true });
    expect(update?.code).toContain("import { globalIgnores } from 'eslint/config';");
    expect(update?.code).not.toContain('uselab.ignores');
    expect(readEslintConfig(update?.code ?? '')).toMatchObject({ ignores, ignoresLegacy: false });
  });

  it('migrates when the scope is not asked', () => {
    const update = updateEslintConfig(withLegacy("['legacy/**']"), { ...PRESETS, ...BOUNDARIES });
    expect(update?.ignoresMigrated).toBe(true);
    expect(spreads(update?.code)[0]).toBe(`globalIgnores(['legacy/**', ${DEFAULTS}]),`);
  });

  it('leaves non-literal ignores() unchanged', () => {
    const text = withLegacy('patterns');
    expect(readEslintConfig(text)).toMatchObject({
      ignoresEditable: false,
      ignoresLegacy: true,
    });
    expect(
      updateEslintConfig(text, {
        ...PRESETS,
        ...BOUNDARIES,
        ignores: { mode: 'exclude', globs: ['legacy/**'] },
      }),
    ).toMatchObject({ ignoresUpdated: false, code: text });
  });
});
