import { describe, expect, it } from 'vitest';
import {
  aliasesPreset,
  browserPreset,
  javascriptPreset,
  nodePreset,
  queryPreset,
} from '../../src/app';
import { byRule, lintSnippet } from '../helpers';

const lint = (config: ReturnType<typeof queryPreset>, file: string, code: string) =>
  lintSnippet([...javascriptPreset(), ...config], file, code);

describe('query preset', () => {
  const config = queryPreset({ library: 'vue-query' });

  it.each([
    ['no-restricted-globals', 'fetch("/api");'],
    ['no-restricted-properties', 'window.fetch("/api");'],
    ['no-restricted-properties', 'globalThis.fetch("/api");'],
    ['@typescript-eslint/no-restricted-imports', "import axios from 'axios';"],
    ['@typescript-eslint/no-restricted-imports', "import ky from 'ky';"],
  ])('reports %s for %s', async (ruleId, code) => {
    const messages = byRule(await lint(config, 'src/features/a.js', code), ruleId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('@tanstack/vue-query');
  });

  it('allows raw HTTP in src/support/http and outside src', async () => {
    const code = 'fetch("/api");';
    expect(
      byRule(await lint(config, 'src/support/http/client.js', code), 'no-restricted-globals'),
    ).toEqual([]);
    expect(byRule(await lint(config, 'scripts/a.js', code), 'no-restricted-globals')).toEqual([]);
  });

  it('supports a custom allow list and a generic message without library', async () => {
    const custom = queryPreset({ allow: ['src/api/**'] });
    expect(
      byRule(await lint(custom, 'src/api/a.js', 'fetch("/");'), 'no-restricted-globals'),
    ).toEqual([]);
    const [message] = byRule(
      await lint(custom, 'src/a.js', 'fetch("/");'),
      'no-restricted-globals',
    );
    expect(message?.message).toContain('a query library');
  });

  it.each([
    ['before', [...queryPreset(), ...browserPreset()]],
    ['after', [...browserPreset(), ...queryPreset()]],
  ])('keeps the browser setAttribute rule when placed %s browser', async (_, combined) => {
    const messages = await lintSnippet(combined, 'src/a.js', 'el.setAttribute("a", "b");');
    expect(byRule(messages, 'no-restricted-properties')).toHaveLength(1);
  });

  it('does not clash with the aliases preset', async () => {
    const messages = await lintSnippet(
      [...aliasesPreset(), ...queryPreset(), ...nodePreset()],
      'src/a.js',
      "import axios from 'axios';\nimport b from '../b';",
    );
    expect(byRule(messages, '@typescript-eslint/no-restricted-imports')).toHaveLength(1);
  });
});
