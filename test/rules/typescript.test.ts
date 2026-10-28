import type { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { configs } from '../../src';
import { byRule, configForFile, lintRule, lintSnippet, loadConfigs, severityOf } from '../helpers';

const config = [...configs.javascript, ...configs.typescript];
const FILE = 'src/some-file.ts';

const applyFix = (code: string, message: Linter.LintMessage | undefined): string => {
  const fix = message?.fix;
  if (!fix) {
    throw new Error('expected a fix');
  }
  return code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1]);
};

describe('@typescript-eslint/consistent-type-definitions (type)', () => {
  const rule = '@typescript-eslint/consistent-type-definitions';

  it('reports interfaces', async () => {
    const code = 'export interface User { name: string }';
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('allows type aliases', async () => {
    const code = 'export type User = { name: string };';
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });
});

describe('@typescript-eslint/consistent-type-imports', () => {
  const rule = '@typescript-eslint/consistent-type-imports';

  it('fixes type-only specifiers with inline type imports', async () => {
    const code = "import { User, load } from './user';\nexport const user: User = load();\n";
    const [message] = await lintRule(config, rule)(FILE, code);
    expect(applyFix(code, message)).toContain("import { type User, load } from './user';");
  });

  it('allows inline type imports', async () => {
    const code = "import { type User, load } from './user';\nexport const user: User = load();\n";
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });

  it('disallows import() type annotations', async () => {
    const code = "export const user: import('./user').User = { name: 'a' };";
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });
});

describe('@typescript-eslint/consistent-type-assertions (never)', () => {
  const rule = '@typescript-eslint/consistent-type-assertions';

  it('reports as-assertions', async () => {
    const code = 'export const f = (value: unknown) => value as string;';
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('reports angle-bracket assertions', async () => {
    const code = 'export const f = (value: unknown) => <string>value;';
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('allows const assertions', async () => {
    const code = "export const sizes = ['sm', 'md'] as const;";
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });
});

describe('no-unused-vars swap', () => {
  const code = 'const unused = 1;\nexport {};';

  it('uses the TypeScript rule instead of the core rule', async () => {
    const messages = await lintSnippet(config, FILE, code);
    expect(byRule(messages, '@typescript-eslint/no-unused-vars')).toHaveLength(1);
    expect(byRule(messages, 'no-unused-vars')).toEqual([]);
  });

  it('is off for root tooling files', async () => {
    const messages = await lintSnippet(config, 'vite.config.ts', code);
    expect(byRule(messages, '@typescript-eslint/no-unused-vars')).toEqual([]);
    expect(byRule(messages, 'no-unused-vars')).toEqual([]);
  });

  it.each([
    ['local (no CI)', { CI: '', NODE_ENV: '' }, 1],
    ['CI', { CI: 'true', NODE_ENV: 'production' }, 2],
  ])('uses dev-mode severity: %s', async (_label, env, expected) => {
    const loaded = await loadConfigs(env);
    const resolved = await configForFile([...loaded.javascript, ...loaded.typescript], FILE);
    expect(severityOf(resolved, '@typescript-eslint/no-unused-vars')).toBe(expected);
  });
});
