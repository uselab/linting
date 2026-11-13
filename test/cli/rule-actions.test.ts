import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): {
    texts: (string | undefined)[];
    asked: {
      message: string;
      initialValue: string;
      validate: (value: string | undefined) => string | undefined;
    }[];
    messages: string[];
    actions: string[];
    ruleActionsAsked: number;
  } => ({ texts: [], asked: [], messages: [], actions: [], ruleActionsAsked: 0 }),
);

vi.mock('@clack/prompts', () => {
  const noop = (): void => {};
  return {
    note: noop,
    cancel: noop,
    isCancel: () => false,
    log: {
      info: (message: string) => prompts.messages.push(`info: ${message}`),
      success: (message: string) => prompts.messages.push(`success: ${message}`),
      warn: (message: string) => prompts.messages.push(`warn: ${message}`),
    },
    text: async (options: (typeof prompts.asked)[number]) => {
      prompts.asked.push(options);
      return prompts.texts.length > 0 ? prompts.texts.shift() : options.initialValue;
    },
  };
});

vi.mock('../../src/features/cli/rule-actions-prompt', () => ({
  askRuleAction: async () => {
    prompts.ruleActionsAsked += 1;
    return prompts.actions.shift() ?? 'skip';
  },
}));

const { applyRuleAction, editGlobalIgnores } = await import('../../src/features/cli/rule-actions');

const DEFAULTS = "'**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo'";

const uselabConfig = (ignores: string): string =>
  [
    "import { globalIgnores } from 'eslint/config';",
    "import { javascriptPreset as uselab } from '@uselab/linting';",
    '',
    'export default [',
    `  globalIgnores([${ignores}]),`,
    '  ...uselab(),',
    "  { rules: { 'no-console': 'off' } },",
    '];',
    '',
  ].join('\n');

const OPT_IN = `'**/*', '!**/*/', '!*.{js,mjs,cjs,ts,mts,cts}', '!src/**', ${DEFAULTS}`;

describe('editGlobalIgnores', () => {
  let dir = '';
  const configPath = (): string => path.join(dir, 'eslint.config.mjs');
  const config = (): string => readFileSync(configPath(), 'utf8');
  const compact = (): string => config().replaceAll(/\s*\n\s*/g, ' ');

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uselab-rule-actions-'));
    prompts.texts = [];
    prompts.asked = [];
    prompts.messages = [];
    prompts.actions = [];
    prompts.ruleActionsAsked = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('edits the globs of the files to skip', async () => {
    writeFileSync(configPath(), uselabConfig(`'legacy/**', ${DEFAULTS}`));
    prompts.texts = ['legacy/**, src/old/**'];

    expect(await editGlobalIgnores(dir)).toBe(true);

    expect(prompts.asked).toMatchObject([
      {
        message: 'Globs of the files to skip (comma separated; empty lints all files)',
        initialValue: 'legacy/**',
      },
    ]);
    expect(compact()).toContain("globalIgnores([ 'legacy/**', 'src/old/**', '**/dist/**',");
    expect(config()).toContain("{ rules: { 'no-console': 'off' } }");
    expect(prompts.messages).toEqual(['success: Updated the ignores in eslint.config.mjs.']);
  });

  it('lints all files when the globs are cleared', async () => {
    writeFileSync(configPath(), uselabConfig(`'legacy/**', ${DEFAULTS}`));
    prompts.texts = [undefined];

    expect(await editGlobalIgnores(dir)).toBe(true);

    expect(compact()).toContain(`globalIgnores([ '**/dist/**',`);
    expect(config()).not.toContain('legacy/**');
  });

  it('edits the globs of the files to lint for an opt-in scope', async () => {
    writeFileSync(configPath(), uselabConfig(OPT_IN));
    prompts.texts = ['src/**, !src/legacy/**, test/**'];

    expect(await editGlobalIgnores(dir)).toBe(true);

    expect(prompts.asked).toMatchObject([
      {
        message: "Globs of the files to lint (comma separated; '!glob' skips files in them)",
        initialValue: 'src/**',
      },
    ]);
    expect(compact()).toContain("'!src/**', '!test/**', 'src/legacy/**', '**/dist/**',");
  });

  it('validates the globs per scope', async () => {
    writeFileSync(configPath(), uselabConfig(OPT_IN));
    await editGlobalIgnores(dir);
    writeFileSync(configPath(), uselabConfig(`'legacy/**', ${DEFAULTS}`));
    await editGlobalIgnores(dir);
    const [optIn, optOut] = prompts.asked.map(({ validate }) => validate);

    expect(optIn?.('src/**, !src/legacy/**')).toBeUndefined();
    expect(optIn?.('!src/legacy/**')).toBe("Enter at least one glob to lint (without '!').");
    expect(optIn?.('')).toBe('Enter at least one glob.');
    expect(optOut?.('')).toBeUndefined();
    expect(optOut?.('!legacy/**')).toBe("Don't start globs with '!'.");
  });

  it('reports unchanged globs', async () => {
    const text = uselabConfig(DEFAULTS);
    writeFileSync(configPath(), text);

    expect(await editGlobalIgnores(dir)).toBe(false);

    expect(config()).toBe(text);
    expect(prompts.messages).toEqual(['info: The ignores in eslint.config.mjs are unchanged.']);
  });

  it.each([
    ['another config', "export default [{ rules: { 'no-var': 'error' } }];\n"],
    ['non-literal patterns', uselabConfig('...patterns')],
  ])('warns without asking for %s', async (_, text) => {
    writeFileSync(configPath(), text);

    expect(await editGlobalIgnores(dir)).toBe(false);

    expect(prompts.asked).toEqual([]);
    expect(config()).toBe(text);
    expect(prompts.messages).toEqual([
      "warn: Can't edit the ignores in eslint.config.mjs automatically; change the globalIgnores([...]) entry by hand.",
    ]);
  });

  it('says which folder the globs are relative to for a config in a parent folder', async () => {
    writeFileSync(configPath(), uselabConfig(DEFAULTS));
    const project = path.join(dir, 'packages', 'web');
    mkdirSync(project, { recursive: true });
    prompts.texts = ['legacy/**'];

    expect(await editGlobalIgnores(project)).toBe(true);

    expect(prompts.asked[0]?.message).toBe(
      `Globs of the files to skip (comma separated, relative to ${dir}; empty lints all files)`,
    );
  });

  it('is asked for from the rule action and counts as a change', async () => {
    writeFileSync(configPath(), uselabConfig(DEFAULTS));
    prompts.actions = ['editIgnores'];
    prompts.texts = ['legacy/**'];

    expect(await applyRuleAction(dir, { ruleId: 'no-var', hint: '' }, { problems: [] })).toBe(
      'changed',
    );

    expect(config()).toContain("'legacy/**'");
  });

  it('asks again when the ignores are unchanged', async () => {
    const text = uselabConfig(DEFAULTS);
    writeFileSync(configPath(), text);
    prompts.actions = ['editIgnores', 'skip'];

    expect(await applyRuleAction(dir, { ruleId: 'no-var', hint: '' }, { problems: [] })).toBe(
      'skipped',
    );

    expect(prompts.ruleActionsAsked).toBe(2);
    expect(config()).toBe(text);
  });

  it('disables the rule', async () => {
    writeFileSync(configPath(), uselabConfig(DEFAULTS));
    prompts.actions = ['disable'];

    expect(await applyRuleAction(dir, { ruleId: 'no-var', hint: '' }, { problems: [] })).toBe(
      'changed',
    );

    expect(config()).toContain("'no-var': 'off'");
  });

  it('finishes', async () => {
    prompts.actions = ['finish'];

    expect(await applyRuleAction(dir, { ruleId: 'no-var', hint: '' }, { problems: [] })).toBe(
      'finished',
    );
  });
});
