import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted((): { spawnSync: ReturnType<typeof vi.fn>; errors: string[] } => ({
  spawnSync: vi.fn(),
  errors: [],
}));

vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
vi.mock('@clack/prompts', () => ({
  log: {
    error: (message: string) => mocks.errors.push(message),
    success: () => {},
  },
}));

const {
  allowWriteTools,
  copilotFixPrompt,
  defaultInstructions,
  fixedInstructions,
  parseModels,
  COPILOT_MISSING_MESSAGE,
  runCopilotFix,
  sanitizeInstructions,
} = await import('../../src/features/cli/copilot-fix');
const { default: copilotConfig } = await import('../../copilot.config.json');
const ruleInstructions = copilotConfig;

describe('parseModels', () => {
  const help = [
    '  `model`: AI model to use for Copilot CLI; can be changed with /model command or',
    '--model flag option. Refer to `copilot help providers`.',
    '      - "claude-sonnet-5.5"',
    '      - "gpt-5.6-sol"',
    '      - "bad name; rm"',
    '  `contextTier`: context window tier',
    '      - "not-a-model"',
  ].join('\n');

  it('reads the quoted names after the model setting', () => {
    expect(parseModels(help)).toEqual(['claude-sonnet-5.5', 'gpt-5.6-sol']);
  });

  it('returns nothing when the model setting is missing', () => {
    expect(parseModels('nothing here')).toEqual([]);
  });
});

describe('copilotFixPrompt', () => {
  const prompt = copilotFixPrompt('@typescript-eslint/no-explicit-any', 'tmp/message.txt');

  it('is limited to the rule and forbids shortcuts', () => {
    expect(prompt).toContain(
      'only the ESLint problems of the rule @typescript-eslint/no-explicit-any',
    );
    expect(prompt).toContain('do not disable the rule');
    expect(prompt).toContain("check '@typescript-eslint/no-explicit-any'");
  });

  it('asks for a commit message in the file and to type /exit', () => {
    expect(prompt).toContain('commit message');
    expect(prompt).toContain('to the file tmp/message.txt');
    expect(prompt).toContain('/exit');
    expect(prompt).not.toContain('{');
  });

  it('is one line without double quotes', () => {
    expect(prompt).not.toMatch(/["`\n]/u);
  });

  it('adds the instructions of the rule, when it has any', () => {
    const lines = ruleInstructions.rules['@typescript-eslint/no-explicit-any'].instructions;
    expect(prompt).toContain(`Specific guidance for this rule: ${lines.join(' ')}`);
  });

  it('leaves the default instructions of every rule unchanged by the sanitizer', () => {
    for (const ruleId of Object.keys(ruleInstructions.rules)) {
      const text = defaultInstructions(ruleId).replaceAll(/\s+/gu, ' ').trim();
      expect(sanitizeInstructions(text), ruleId).toBe(text);
    }
  });

  it('leaves the prompt without a stray placeholder for other rules', () => {
    const other = copilotFixPrompt('no-console', 'tmp/message.txt');
    expect(other).not.toContain('Specific guidance');
    expect(other).not.toContain('{');
    expect(other).not.toContain('  ');
  });

  it('ignores prototype keys as rule ids', () => {
    expect(copilotFixPrompt('constructor', 'm.txt')).not.toContain('Specific guidance');
  });

  it('offers the default instructions with one line per sentence', () => {
    const defaults = defaultInstructions('no-console');
    expect(defaults.split('\n')).toHaveLength(copilotConfig.prompt.length);
    expect(copilotConfig.prompt.length).toBeGreaterThan(1);
    expect(defaults).toContain('rule no-console');
    expect(defaults).not.toContain('{');
    expect(defaults).not.toContain('/exit');
  });

  it('puts the fixed instructions in front of the instructions', () => {
    const edited = copilotFixPrompt('no-console', 'm.txt', {
      instructions: 'keep the API\nplease',
    });
    expect(edited).toBe(`${fixedInstructions('no-console', 'm.txt')} keep the API please`);
    expect(fixedInstructions('no-console', 'm.txt')).toContain('to the file m.txt');
    expect(fixedInstructions('no-console', 'm.txt')).toContain("check 'no-console'");
    expect(fixedInstructions('no-console', 'm.txt')).toContain('/exit');
  });
});

describe('sanitizeInstructions', () => {
  it('makes text safe for a double-quoted shell argument', () => {
    expect(sanitizeInstructions('say "hi"\n`rm` $HOME & more | <x> %y% ^z \\')).toBe(
      "say 'hi' rm HOME more x y z",
    );
  });

  it('keeps plain text', () => {
    expect(sanitizeInstructions("  don't touch src/a.ts  ")).toBe("don't touch src/a.ts");
  });
});

describe('copilot.config.json rules', () => {
  const entries: [string, { instructions?: string[]; defaultMode?: string }][] = Object.entries(
    ruleInstructions.rules,
  );

  it.each(entries)('is shell-safe for %s', (ruleId, settings) => {
    const { instructions = [], defaultMode } = settings;
    expect(ruleId).toMatch(/^[\w@/.-]+$/u);
    expect(instructions.length > 0 || defaultMode !== undefined).toBe(true);
    for (const line of instructions) {
      expect(line.trim()).not.toBe('');
      expect(line).not.toMatch(/["`\n{}]/u);
    }
  });
});

describe('allowWriteTools', () => {
  it('allows the message file and the files with problems', () => {
    expect(allowWriteTools('m.txt', ['src/a.ts', 'src/b.ts'])).toBe(
      'write(m.txt),write(src/a.ts),write(src/b.ts)',
    );
  });

  it('skips paths that are unsafe in a command line', () => {
    expect(allowWriteTools('m.txt', ['src/my file.ts', 'a"b.ts', 'c,d.ts', 'ok.ts'])).toBe(
      'write(m.txt),write(ok.ts)',
    );
  });

  it('only allows the message file when the list is too long', () => {
    const files = Array.from({ length: 1000 }, (_, index) => `src/file-${index}.ts`);
    expect(allowWriteTools('m.txt', files)).toBe('write(m.txt)');
  });
});

describe('runCopilotFix', () => {
  let dir = '';

  beforeEach(() => {
    mocks.spawnSync.mockReset();
    mocks.errors.length = 0;
    dir = mkdtempSync(path.join(tmpdir(), 'copilot-fix-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Simulates Copilot writing the message file named in the prompt. */
  const copilotWrites = (text: string, status = 0) =>
    mocks.spawnSync.mockImplementation((_command: string, args: string[]) => {
      const file = /to the file (\S+),/u.exec(args[1] ?? '')?.[1];
      if (args[0] === '-i' && file) {
        writeFileSync(path.join(dir, file), text);
      }
      return { status: args[0] === '-i' ? status : 0 };
    });

  it('fails with a message when copilot is not available', () => {
    mocks.spawnSync.mockReturnValue({ status: 1 });
    expect(runCopilotFix(dir, 'no-console', { files: [] })).toEqual({ ok: false });
    expect(mocks.errors).toEqual([COPILOT_MISSING_MESSAGE]);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  it('starts copilot interactively, allowing writes to the rule files', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    expect(runCopilotFix(dir, 'no-console', { files: ['src/a.ts'] })).toEqual({ ok: true });
    const [command, args, options] = mocks.spawnSync.mock.calls[1] ?? [];
    expect(command).toBe('copilot');
    expect(args[0]).toBe('-i');
    expect(args[1]).toContain('no-console');
    expect(args[2]).toMatch(
      /^--allow-tool="write\(node_modules\/.+\.txt\),write\(src\/a\.ts\),shell\(npx uselab-linting:\*\),shell\(cd\),shell\(Select-Object\),shell\(Select-String\)"$/u,
    );
    expect(options).toMatchObject({ cwd: dir, stdio: 'inherit' });
  });

  it('starts copilot with --mode unless interactive', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    runCopilotFix(dir, 'no-console', { files: [], mode: 'plan' });
    runCopilotFix(dir, 'no-console', { files: [], mode: 'interactive' });
    runCopilotFix(dir, 'no-console', { files: [], mode: 'autopilot' });
    expect(mocks.spawnSync.mock.calls[1]?.[1].slice(-2)).toEqual(['--mode', 'plan']);
    expect(mocks.spawnSync.mock.calls[3]?.[1]).not.toContain('--mode');
    expect(mocks.spawnSync.mock.calls[5]?.[1].slice(-2)).toEqual(['--mode', 'autopilot']);
  });

  it('starts copilot with --model only when a model is given', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    runCopilotFix(dir, 'no-console', { files: [], model: 'gpt-5.6-sol' });
    runCopilotFix(dir, 'no-console', { files: [] });
    expect(mocks.spawnSync.mock.calls[1]?.[1].slice(-2)).toEqual(['--model', 'gpt-5.6-sol']);
    expect(mocks.spawnSync.mock.calls[3]?.[1]).not.toContain('--model');
  });

  it('refuses a model name that is unsafe for a shell', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    expect(runCopilotFix(dir, 'no-console', { files: [], model: 'x; rm -rf /' })).toEqual({
      ok: false,
    });
    expect(mocks.spawnSync).toHaveBeenCalledTimes(0);
  });

  it('writes the problems to a file for the prompt, and removes it afterwards', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    let content: string | undefined;
    mocks.spawnSync.mockImplementation((_command: string, args: string[]) => {
      const file = /(node_modules\/\.cache\/uselab-linting\/problems-[\w-]+\.txt)/u.exec(
        args[1] ?? '',
      )?.[1];
      content =
        file && existsSync(path.join(dir, file))
          ? readFileSync(path.join(dir, file), 'utf8')
          : undefined;
      return { status: 0 };
    });
    runCopilotFix(dir, 'no-console', {
      files: ['src/a.ts'],
      problems: [
        {
          ruleId: 'no-console',
          file: 'src/a.ts',
          line: 3,
          column: 5,
          message: 'No console.',
          severity: 2,
          fixable: false,
        },
      ],
    });
    expect(content).toBe('ESLint problems of no-console:\nsrc/a.ts:3:5  error  No console.\n');
    expect(readdirSync(path.join(dir, 'node_modules/.cache/uselab-linting'))).toEqual([]);
  });

  it('uses the edited instructions, sanitized, after the fixed instructions', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    runCopilotFix(dir, 'no-console', { files: [], instructions: 'say "hi" `x`\nsecond' });
    const prompt: string = mocks.spawnSync.mock.calls[1]?.[1][1];
    expect(prompt).toMatch(
      /^"The problems to fix are listed in the file node_modules\/\.cache\/uselab-linting\/problems-.*commit-.* say 'hi' x second"$/u,
    );
    expect(prompt).not.toContain('{messageFile}');
    expect(prompt).not.toContain('Fix only');
  });

  it('returns the first line of the commit message and removes the file', () => {
    copilotWrites('\nFix no-console usages\nmore\n');
    expect(runCopilotFix(dir, 'no-console', { files: [] })).toEqual({
      ok: true,
      message: 'Fix no-console usages',
    });
    expect(readdirSync(path.join(dir, 'node_modules/.cache/uselab-linting'))).toEqual([]);
  });

  it('returns no message when copilot wrote none', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    expect(runCopilotFix(dir, 'no-console', { files: [] }).message).toBeUndefined();
    expect(existsSync(path.join(dir, 'node_modules/.cache/uselab-linting'))).toBe(true);
  });

  it('reports a failing copilot', () => {
    copilotWrites('x', 1);
    expect(runCopilotFix(dir, 'no-console', { files: [] }).ok).toBe(false);
    expect(mocks.errors).toEqual(['Copilot did not finish successfully.']);
  });

  it('rejects rule names that are unsafe for a shell', () => {
    expect(runCopilotFix(dir, 'x"; rm -rf /', { files: [] })).toEqual({ ok: false });
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});
