import { describe, expect, it } from 'vitest';
import { disableRules, disableRulesSection } from '../../src/features/cli/disable-rules';

const uselabConfig = `import { configs } from '@uselab/linting';

export default [
  ...configs.javascript(),
  {
    rules: { 'no-var': 'error' },
  },
  ...configs.prettier(),
];
`;

describe('disableRules', () => {
  it('adds a disable-rules section before the prettier preset', () => {
    expect(disableRules(uselabConfig, ['vue/no-setup-props-reactivity-loss', 'complexity']))
      .toBe(`import { configs } from '@uselab/linting';

export default [
  ...configs.javascript(),
  {
    rules: { 'no-var': 'error' },
  },
  // disable-rules
  {
    rules: {
      'vue/no-setup-props-reactivity-loss': 'off',
      complexity: 'off',
    },
  },
  ...configs.prettier(),
];
`);
  });

  it('adds the section at the end without a prettier preset, also in defineConfig()', () => {
    const text = `import { defineConfig } from 'eslint/config';

export default defineConfig([{ rules: { eqeqeq: 'error' } }]);
`;
    const updated = disableRules(text, ['eqeqeq']) ?? '';
    expect(updated).toContain(
      "  { rules: { eqeqeq: 'error' } },\n  // disable-rules\n  {\n    rules: {\n      eqeqeq: 'off',\n    },\n  },\n]);",
    );
  });

  it('merges new rules into an existing section', () => {
    const once = disableRules(uselabConfig, ['complexity']) ?? '';
    const twice = disableRules(once, ['complexity', 'max-lines']) ?? '';
    expect(twice.match(/disable-rules/gu)).toHaveLength(1);
    expect(twice).toContain(
      "    rules: {\n      complexity: 'off',\n      'max-lines': 'off',\n    },",
    );
    expect(twice.match(/complexity/gu)).toHaveLength(1);
  });

  it('returns undefined for configs it cannot edit', () => {
    expect(disableRules('const config = [];\nexport default config;\n', ['a'])).toBeUndefined();
    expect(disableRules('export default [', ['a'])).toBeUndefined();
    expect(
      disableRules('export default [\n  // disable-rules\n  { files: [] },\n];\n', ['a']),
    ).toBeUndefined();
  });
});

describe('disableRulesSection', () => {
  it('is a snippet to add manually', () => {
    expect(disableRulesSection(['a/b'])).toBe(
      "// disable-rules\n{\n  rules: {\n    'a/b': 'off',\n  },\n},",
    );
  });
});
