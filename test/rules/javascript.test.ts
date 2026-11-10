import { describe, expect, it } from 'vitest';
import { configs } from '../../src/app';
import { configForFile, lintRule, loadConfigs, severityOf, statements } from '../helpers';

const config = configs.javascript();
const FILE = 'src/some-file.js';

const ifChain = (count: number): string =>
  Array.from({ length: count }, (_, index) => `  if (a === ${index}) { foo(); }`).join('\n');

const nestedIfs = (depth: number): string => {
  const open = Array.from({ length: depth }, (_, index) => `if (a${index}) {`).join('\n');
  return `${open}\nfoo();\n${'}\n'.repeat(depth)}`;
};

describe('no-restricted-imports', () => {
  it('is not part of the javascript preset (see the aliases preset)', async () => {
    expect(await lintRule(config, 'no-restricted-imports')(FILE, "import a from '../a';")).toEqual(
      [],
    );
  });
});

describe('max-params (max 3)', () => {
  it('allows 3 params', async () => {
    expect(
      await lintRule(config, 'max-params')(FILE, 'export const f = (a, b, c) => a + b + c;'),
    ).toEqual([]);
  });

  it('reports 4 params', async () => {
    const code = 'export const f = (a, b, c, d) => a + b + c + d;';
    expect(await lintRule(config, 'max-params')(FILE, code)).toHaveLength(1);
  });
});

describe('complexity (max 10)', () => {
  it('allows complexity 10', async () => {
    const code = `export const f = (a) => {\n${ifChain(9)}\n};`;
    expect(await lintRule(config, 'complexity')(FILE, code)).toEqual([]);
  });

  it('reports complexity 11', async () => {
    const code = `export const f = (a) => {\n${ifChain(10)}\n};`;
    expect(await lintRule(config, 'complexity')(FILE, code)).toHaveLength(1);
  });
});

describe('max-depth (max 4)', () => {
  it('allows depth 4', async () => {
    const code = `export const f = () => {\n${nestedIfs(4)}};`;
    expect(await lintRule(config, 'max-depth')(FILE, code)).toEqual([]);
  });

  it('reports depth 5', async () => {
    const code = `export const f = () => {\n${nestedIfs(5)}};`;
    expect(await lintRule(config, 'max-depth')(FILE, code)).toHaveLength(1);
  });
});

describe('max-lines (max 500, skip blank lines and comments)', () => {
  const padding = '\n\n// comment\n/* block\n   comment */\n'.repeat(20);

  it('allows 500 code lines plus blank lines and comments', async () => {
    const code = `${padding}${statements(500)}${padding}`;
    expect(await lintRule(config, 'max-lines')(FILE, code)).toEqual([]);
  });

  it('reports 501 code lines', async () => {
    expect(await lintRule(config, 'max-lines')(FILE, statements(501))).toHaveLength(1);
  });

  it('is off for eslint.config.* files', async () => {
    expect(await lintRule(config, 'max-lines')('eslint.config.js', statements(501))).toEqual([]);
  });

  it('is off for test files', async () => {
    expect(await lintRule(config, 'max-lines')('test/some-file.js', statements(501))).toEqual([]);
  });
});

describe('max-lines-per-function (max 100, skip blank lines and comments, IIFEs)', () => {
  const fn = (bodyLines: number): string =>
    `export const f = () => {\n\n// comment\n${statements(bodyLines, '  ')}\n\n};`;

  it('allows 100 lines', async () => {
    expect(await lintRule(config, 'max-lines-per-function')(FILE, fn(98))).toEqual([]);
  });

  it('reports 101 lines', async () => {
    expect(await lintRule(config, 'max-lines-per-function')(FILE, fn(99))).toHaveLength(1);
  });

  it('checks IIFEs', async () => {
    const code = `(() => {\n${statements(99, '  ')}\n})();`;
    expect(await lintRule(config, 'max-lines-per-function')(FILE, code)).toHaveLength(1);
  });

  it.each(['test/some-file.js', 'test/nested/deep/some-file.test.js'])(
    'is off for test files (%s)',
    async (file) => {
      expect(await lintRule(config, 'max-lines-per-function')(file, fn(99))).toEqual([]);
    },
  );

  it.each(['src/some-file.test.js', 'tests/some-file.js'])(
    'applies outside test/ (%s)',
    async (file) => {
      expect(await lintRule(config, 'max-lines-per-function')(file, fn(99))).toHaveLength(1);
    },
  );

  describe('with custom testFiles', () => {
    const custom = configs.javascript({ testFiles: ['tests/**/*.js', '**/*.e2e.js'] });

    it.each(['tests/some-file.js', 'src/some-file.e2e.js'])(
      'is off for matching files (%s)',
      async (file) => {
        expect(await lintRule(custom, 'max-lines-per-function')(file, fn(99))).toEqual([]);
      },
    );

    it('replaces the default globs', async () => {
      const lint = lintRule(custom, 'max-lines-per-function');
      expect(await lint('src/some-file.test.js', fn(99))).toHaveLength(1);
    });
  });

  describe('without test files', () => {
    const none = configs.javascript({ testFiles: [] });

    it('has no tests block', () => {
      expect(none.map((entry) => entry.name)).not.toContain('uselab/javascript/tests');
    });

    it('applies to test/', async () => {
      const lint = lintRule(none, 'max-lines-per-function');
      expect(await lint('test/some-file.js', fn(99))).toHaveLength(1);
    });
  });
});

describe('no-param-reassign (props: true)', () => {
  it('reports reassigning a parameter', async () => {
    const code = 'export const f = (p) => { p = 1; return p; };';
    expect(await lintRule(config, 'no-param-reassign')(FILE, code)).toHaveLength(1);
  });

  it('reports mutating parameter properties', async () => {
    const code = 'export const f = (p) => { p.x = 1; };';
    expect(await lintRule(config, 'no-param-reassign')(FILE, code)).toHaveLength(1);
  });

  it('allows mutating local objects', async () => {
    const code = 'export const f = () => { const o = {}; o.x = 1; return o; };';
    expect(await lintRule(config, 'no-param-reassign')(FILE, code)).toEqual([]);
  });
});

describe('no-implicit-coercion (boolean: true)', () => {
  it('reports !!value', async () => {
    const code = 'export const f = (x) => !!x;';
    expect(await lintRule(config, 'no-implicit-coercion')(FILE, code)).toHaveLength(1);
  });

  it('allows Boolean(value)', async () => {
    const code = 'export const f = (x) => Boolean(x);';
    expect(await lintRule(config, 'no-implicit-coercion')(FILE, code)).toEqual([]);
  });
});

describe('default-case (commentPattern: ^no default$)', () => {
  const sw = (comment: string): string =>
    `export const f = (x) => {\n  switch (x) {\n    case 1:\n      return 1;\n    ${comment}\n  }\n  return 0;\n};`;

  it('allows a "// no default" comment', async () => {
    expect(await lintRule(config, 'default-case')(FILE, sw('// no default'))).toEqual([]);
  });

  it('reports other comments', async () => {
    expect(await lintRule(config, 'default-case')(FILE, sw('// nothing to do'))).toHaveLength(1);
  });
});

describe('no-restricted-syntax', () => {
  it('reports null literals', async () => {
    const code = 'export const a = null;';
    expect(await lintRule(config, 'no-restricted-syntax')(FILE, code)).toHaveLength(1);
  });

  it('allows class declarations', async () => {
    const code = 'export class A {}';
    expect(await lintRule(config, 'no-restricted-syntax')(FILE, code)).toEqual([]);
  });
});

describe('prefer-arrow-callback (allowNamedFunctions: false)', () => {
  it('reports named function callbacks', async () => {
    const code = 'export const a = [1].map(function double(x) { return x * 2; });';
    expect(await lintRule(config, 'prefer-arrow-callback')(FILE, code)).toHaveLength(1);
  });
});

describe('func-style (expression, allowArrowFunctions)', () => {
  it('reports function declarations', async () => {
    const code = 'export function f() { return 1; }';
    expect(await lintRule(config, 'func-style')(FILE, code)).toHaveLength(1);
  });

  it('allows arrow functions and function expressions', async () => {
    const code = 'export const f = () => 1;\nexport const g = function () { return 1; };';
    expect(await lintRule(config, 'func-style')(FILE, code)).toEqual([]);
  });
});

describe('unicorn/filename-case (kebabCase)', () => {
  const code = 'export const a = 1;';

  it('allows kebab-case', async () => {
    expect(await lintRule(config, 'unicorn/filename-case')('src/my-file.js', code)).toEqual([]);
  });

  it.each(['src/MyFile.js', 'src/myFile.js', 'src/my_file.js'])('reports %s', async (file) => {
    expect(await lintRule(config, 'unicorn/filename-case')(file, code)).toHaveLength(1);
  });
});

describe('dev-mode severity', () => {
  const devRules = ['no-console', 'no-debugger', 'no-unused-vars'];

  it.each([
    ['local (no CI)', { CI: '', NODE_ENV: '' }, 1],
    ['NODE_ENV=development in CI', { CI: 'true', NODE_ENV: 'development' }, 1],
    ['CI', { CI: 'true', NODE_ENV: 'production' }, 2],
  ])('%s', async (_label, env, expected) => {
    const loaded = await loadConfigs(env);
    const resolved = await configForFile(loaded.javascript(), FILE);
    for (const rule of devRules) {
      expect(severityOf(resolved, rule), rule).toBe(expected);
    }
  });
});

describe('root tooling files and CommonJS', () => {
  it('turns off no-console for root tooling files only', async () => {
    const code = 'console.log(process.env.NODE_ENV);';
    expect(await lintRule(config, 'no-console')('vite.config.mjs', code)).toEqual([]);
    expect(await lintRule(config, 'no-console')('src/vite.config.mjs', code)).toHaveLength(1);
  });

  it('adds Node globals to root tooling files', async () => {
    const code = 'export default { mode: process.env.NODE_ENV };';
    expect(await lintRule(config, 'no-undef')('vite.config.mjs', code)).toEqual([]);
  });

  it('treats .cjs files as CommonJS with Node globals', async () => {
    const code = "const path = require('node:path');\nmodule.exports = path.join(__dirname, 'a');";
    expect(await lintRule(config, 'no-undef')('src/legacy.cjs', code)).toEqual([]);
  });
});
