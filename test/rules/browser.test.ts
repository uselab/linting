import { describe, expect, it } from 'vitest';
import { configs, type Config } from '../../src/app';
import { lintRule, lintSnippet } from '../helpers';

const config = [...configs.javascript(), ...configs.browser()];

describe('classList mutation (no-restricted-syntax)', () => {
  const rule = 'no-restricted-syntax';

  it.each([
    "element.classList.add('a');",
    "element.classList.remove('a');",
    "element.classList.toggle('a');",
    "document.body.classList.add('a');",
    "const { classList } = document.body;\nclassList.add('a');",
  ])('reports %s', async (code) => {
    expect(await lintRule(config, rule)('src/dom.js', code)).toHaveLength(1);
  });

  it('allows other classList methods and unrelated add() calls', async () => {
    const code =
      "export const has = (element) => element.classList.contains('a');\nnew Set().add(1);";
    expect(await lintRule(config, rule)('src/dom.js', code)).toEqual([]);
  });

  it('keeps the base null restriction and allows classes', async () => {
    const code = 'export const value = null;\nexport class Store {}';
    expect(await lintRule(config, rule)('src/dom.js', code)).toHaveLength(1);
  });

  it('does not apply outside src/', async () => {
    expect(
      await lintRule(config, rule)('scripts/dom.js', "document.body.classList.add('a');"),
    ).toEqual([]);
  });

  // One violation per line: classList (2), inline style (3), null (4).
  const tsx =
    "export const Card = () => {\n  document.body.classList.add('a');\n  const p = <p style={{}} />;\n  return p ?? null;\n};";
  const orders: [string, Config[]][] = [
    [
      'browser before react',
      [...configs.javascript(), ...configs.typescript(), ...configs.browser(), ...configs.react()],
    ],
    [
      'browser after react',
      [...configs.javascript(), ...configs.typescript(), ...configs.react(), ...configs.browser()],
    ],
  ];

  it.each(orders)('combines with the React JSX restrictions (%s)', async (_label, ordered) => {
    const messages = await lintRule(ordered, rule)('src/card.tsx', tsx);
    expect(messages.map((message) => message.line)).toEqual([2, 3, 4]);
  });
});

describe('no-restricted-properties', () => {
  const rule = 'no-restricted-properties';

  it.each(["element.setAttribute('a', 'b');", "element.removeAttribute('a');"])(
    'reports %s',
    async (code) => {
      expect(await lintRule(config, rule)('src/dom.js', code)).toHaveLength(1);
    },
  );

  it.each(['src/dom.ts', 'src/dom.tsx', 'src/components/dom.vue'])(
    'applies to %s',
    async (file) => {
      const code = file.endsWith('.vue')
        ? "<script setup lang=\"ts\">\ndocument.body.setAttribute('a', 'b');\n</script>\n"
        : "document.body.setAttribute('a', 'b');";
      const full = [
        ...configs.javascript(),
        ...configs.typescript(),
        ...configs.vue(),
        ...configs.browser(),
      ];
      expect(await lintRule(full, rule)(file, code)).toHaveLength(1);
    },
  );

  it('does not apply outside src/', async () => {
    const code = "document.body.setAttribute('a', 'b');";
    expect(await lintRule(config, rule)('scripts/dom.js', code)).toEqual([]);
  });
});

describe('browser globals', () => {
  it('defines browser globals', async () => {
    const code = 'export const width = window.innerWidth + document.body.clientWidth;';
    expect(await lintRule(config, 'no-undef')('src/size.js', code)).toEqual([]);
  });
});

describe('browser({ files }) + node({ ignores })', () => {
  const globs = ['web/**'];
  const scoped = [
    ...configs.javascript(),
    ...configs.browser({ files: globs }),
    ...configs.node({ ignores: globs }),
  ];

  it('gives the browser files browser globals, not Node ones', async () => {
    const lint = lintRule(scoped, 'no-undef');
    expect(await lint('web/size.js', 'export const width = window.innerWidth;')).toEqual([]);
    expect(await lint('web/env.js', 'export const env = process.env;')).toHaveLength(1);
  });

  it('gives the other files Node globals, not browser ones', async () => {
    const lint = lintRule(scoped, 'no-undef');
    expect(await lint('server/env.js', 'export const env = process.env;')).toEqual([]);
    expect(await lint('server/size.js', 'export const width = window.innerWidth;')).toHaveLength(1);
  });

  it('applies the UI enforcement rules to the browser files only', async () => {
    const code = "document.body.setAttribute('a', 'b');\ndocument.body.classList.add('a');";
    expect(await lintSnippet(scoped, 'web/dom.js', code)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-properties' }),
        expect.objectContaining({ ruleId: 'no-restricted-syntax' }),
      ]),
    );
    expect(await lintRule(scoped, 'no-restricted-properties')('src/dom.js', code)).toEqual([]);
  });
});
