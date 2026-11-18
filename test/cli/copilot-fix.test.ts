import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  COPILOT_MISSING_MESSAGE,
  runCopilotFix,
  sanitizeInstructions,
} = await import('../../src/features/cli/copilot-fix');
const { default: copilotFix } = await import('../../src/features/cli/copilot-fix.json');
const ruleInstructions = copilotFix;

describe('copilotFixPrompt', () => {
  const prompt = copilotFixPrompt('@typescript-eslint/no-explicit-any', 'tmp/message.txt');

  it('is limited to the rule and forbids shortcuts', () => {
    expect(prompt).toContain(
      'only the ESLint problems of the rule @typescript-eslint/no-explicit-any',
    );
    expect(prompt).toContain('do not disable the rule');
    expect(prompt).toContain("check '@typescript-eslint/no-explicit-any'");
  });

  it('allows commenting out only with permission', () => {
    expect(prompt).toContain('ask me for permission before commenting it out');
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
    const lines = ruleInstructions.rules['@typescript-eslint/no-explicit-any'];
    expect(prompt).toContain(`Specific guidance for this rule: ${lines.join(' ')}`);
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

  it('appends the instructions of the user', () => {
    expect(copilotFixPrompt('no-console', 'm.txt', 'keep the API')).toMatch(
      /Extra instructions from the user: keep the API$/u,
    );
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

describe('copilot-fix.json rules', () => {
  it.each(Object.entries(ruleInstructions.rules))('is shell-safe for %s', (ruleId, lines) => {
    expect(ruleId).toMatch(/^[\w@/.-]+$/u);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
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

  it('adds sanitized extra instructions to the prompt', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    runCopilotFix(dir, 'no-console', { files: [], instructions: 'say "hi" `x`' });
    expect(mocks.spawnSync.mock.calls[1]?.[1][1]).toContain(
      "Extra instructions from the user: say 'hi' x",
    );
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
