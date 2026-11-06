import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): {
    confirms: boolean[];
    messages: string[];
    actions: Record<string, string>;
    rounds: Record<string, string>[];
    choices: string[][];
  } => ({
    confirms: [],
    messages: [],
    actions: {},
    rounds: [],
    choices: [],
  }),
);

vi.mock('@clack/prompts', () => {
  const noop = (): void => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    cancel: noop,
    isCancel: () => false,
    log: { info: noop, success: noop, warn: noop },
    spinner: () => ({ start: noop, stop: noop }),
    confirm: async ({ message, initialValue }: { message: string; initialValue: boolean }) => {
      prompts.messages.push(`${message} [${initialValue ? 'Y' : 'N'}]`);
      return prompts.confirms.shift() ?? false;
    },
  };
});

vi.mock('../../src/features/cli/rule-actions-prompt', () => ({
  askRuleActions: async (choices: { ruleId: string; hint: string }[]) => {
    prompts.messages.push('What to do with the rules?');
    prompts.choices.push(choices.map(({ ruleId, hint }) => `${ruleId}: ${hint}`));
    const actions = prompts.rounds.shift() ?? prompts.actions;
    return new Map(choices.map(({ ruleId }) => [ruleId, actions[ruleId] ?? 'keep']));
  },
}));

const {
  ANALYSIS_REPORT_FILE,
  analyzeProblems,
  codeExcerpt,
  formatMarkdownReport,
  formatTerminalReport,
  PARSE_ERROR_RULE,
  pickExamples,
  runAnalyze,
  summarizeRules,
} = await import('../../src/features/cli/analyze');

type Problem = Parameters<typeof codeExcerpt>[0];

const problem = (overrides: Partial<Problem>): Problem => ({
  ruleId: 'rule',
  file: 'a.ts',
  line: 2,
  column: 1,
  message: 'message',
  severity: 2,
  fixable: false,
  ...overrides,
});

const sources: Record<string, string[]> = {
  'a.ts': ['const a = 1;', 'var x = 1;', 'const b = 2;', 'var y = 2;', 'end();'],
  'b.ts': ['const a = 1;', 'var x = 1;', 'const b = 2;'],
  'c.ts': ['first();', 'var z = 3;'],
};
const readSource = (file: string): string[] | undefined => sources[file];

describe('codeExcerpt', () => {
  it('shows the offending line with one line of context', () => {
    expect(codeExcerpt(problem({ line: 2 }), sources['a.ts'] ?? []).lines).toEqual([
      { number: 1, text: 'const a = 1;', offending: false },
      { number: 2, text: 'var x = 1;', offending: true },
      { number: 3, text: 'const b = 2;', offending: false },
    ]);
  });

  it('stays within the file', () => {
    const source = sources['c.ts'] ?? [];
    expect(codeExcerpt(problem({ line: 1 }), source).lines.map(({ number }) => number)).toEqual([
      1, 2,
    ]);
    expect(codeExcerpt(problem({ line: 2 }), source).lines.map(({ number }) => number)).toEqual([
      1, 2,
    ]);
  });

  it('clips long lines around the column', () => {
    const line = `${'a'.repeat(300)}X${'b'.repeat(300)}`;
    const [excerpt] = codeExcerpt(problem({ line: 1, column: 301 }), [line]).lines;
    expect(excerpt?.text).toMatch(/^….*X.*…$/u);
    expect(excerpt?.text.length).toBeLessThanOrEqual(162);
  });
});

describe('pickExamples', () => {
  it('picks up to 3 examples from different files first', () => {
    const examples = pickExamples(
      [
        problem({ file: 'a.ts', line: 2 }),
        problem({ file: 'a.ts', line: 4 }),
        problem({ file: 'c.ts', line: 2 }),
        problem({ file: 'a.ts', line: 5 }),
      ],
      readSource,
    );
    expect(examples.map(({ problem: { file, line } }) => `${file}:${line}`)).toEqual([
      'a.ts:2',
      'c.ts:2',
      'a.ts:4',
    ]);
  });

  it('skips identical excerpts', () => {
    const examples = pickExamples(
      [
        problem({ file: 'a.ts', line: 2, column: 1 }),
        problem({ file: 'a.ts', line: 2, column: 5 }),
        problem({ file: 'b.ts', line: 2 }),
        problem({ file: 'a.ts', line: 4 }),
      ],
      readSource,
    );
    expect(examples.map(({ problem: { file, line } }) => `${file}:${line}`)).toEqual([
      'a.ts:2',
      'a.ts:4',
    ]);
  });

  it('prefers problems without an autofix', () => {
    const examples = pickExamples(
      [problem({ file: 'a.ts', line: 2, fixable: true }), problem({ file: 'c.ts', line: 2 })],
      readSource,
    );
    expect(examples.map(({ problem: { file } }) => file)).toEqual(['c.ts', 'a.ts']);
  });
});

describe('summarizeRules', () => {
  it('ranks non-fixable errors, non-fixable warnings, fixable errors, fixable warnings', () => {
    const rules = summarizeRules(
      [
        problem({ ruleId: 'fixable-warning', severity: 1, fixable: true }),
        problem({ ruleId: 'fixable-warning', severity: 1, fixable: true }),
        problem({ ruleId: 'fixable-error', fixable: true }),
        problem({ ruleId: 'warning', severity: 1 }),
        problem({ ruleId: 'error' }),
        problem({ ruleId: 'errors' }),
        problem({ ruleId: 'errors', file: 'b.ts' }),
        problem({ ruleId: 'errors', fixable: true }),
      ],
      readSource,
    );
    expect(rules.map(({ ruleId }) => ruleId)).toEqual([
      'errors',
      'error',
      'warning',
      'fixable-error',
      'fixable-warning',
    ]);
    expect(rules[0]).toMatchObject({
      errors: 3,
      fixableErrors: 1,
      warnings: 0,
      files: [
        { file: 'a.ts', count: 2 },
        { file: 'b.ts', count: 1 },
      ],
    });
  });
});

describe('analyzeProblems', () => {
  const problems = [
    problem({ ruleId: 'fixable', fixable: true }),
    problem({ ruleId: 'mixed', fixable: true }),
    problem({ ruleId: 'mixed', severity: 1 }),
  ];

  it('keeps all problems by default', () => {
    expect(analyzeProblems(problems, readSource).rules.map(({ ruleId }) => ruleId)).toEqual([
      'mixed',
      'fixable',
    ]);
  });

  it('can exclude the auto-fixable problems', () => {
    const analysis = analyzeProblems(problems, readSource, true);
    expect(analysis.excludedFixable).toBe(2);
    expect(analysis.rules).toMatchObject([{ ruleId: 'mixed', errors: 0, warnings: 1 }]);
  });
});

describe('reports', () => {
  const analysis = analyzeProblems(
    [
      problem({ ruleId: 'no-var', file: 'a.ts', line: 2, message: 'Unexpected var.' }),
      problem({ ruleId: 'no-var', file: 'c.ts', line: 2, fixable: true }),
      problem({ ruleId: PARSE_ERROR_RULE, file: 'b.ts', line: 1, severity: 1 }),
    ],
    readSource,
  );

  it('prints the rules with counts and excerpts', () => {
    const report = formatTerminalReport(analysis);
    expect(report).toContain('2 errors (1 fixable), 1 warning in 2 rules.');
    expect(report).toContain(
      '1. no-var — 2 errors (1 fixable) in 2 files\n   - a.ts (1)\n   - c.ts (1)\n',
    );
    expect(report).toContain(
      '   a.ts:2:1  Unexpected var.\n     1 | const a = 1;\n   > 2 | var x = 1;',
    );
    expect(report).toContain(`2. ${PARSE_ERROR_RULE} — 1 warning in 1 file`);
    expect(report).toContain('1 problem can be fixed automatically with `npm run lint:fix`.');
  });

  it('writes markdown with code fences', () => {
    const report = formatMarkdownReport(analysis);
    expect(report).toContain('## 1. `no-var`');
    expect(report).toContain('2 errors (1 fixable) in 2 files:\n\n- `a.ts` (1)\n- `c.ts` (1)\n');
    expect(report).toContain(
      '`a.ts:2:1` Unexpected var.\n\n```ts\n  1 | const a = 1;\n> 2 | var x = 1;',
    );
  });

  it('reports no problems', () => {
    expect(formatTerminalReport({ rules: [] })).toBe('ESLint analysis\nNo problems found.');
  });
});

describe('runAnalyze', () => {
  let dir = '';
  let output = '';

  const write = (file: string, content: string): void => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'uselab-analyze-'));
    output = '';
    prompts.confirms = [];
    prompts.messages = [];
    prompts.actions = {};
    prompts.rounds = [];
    prompts.choices = [];
    process.exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    write(
      'eslint.config.mjs',
      "export default [{ rules: { 'no-var': 'error', 'no-console': 'warn' } }];\n",
    );
    write('src/a.js', 'var a = 1;\nconsole.log(a);\n');
    write('src/b.js', 'console.log(2);\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lints the project, prints the report and fails on errors', async () => {
    await runAnalyze(dir, false);

    expect(output).toContain('1. no-console — 2 warnings in 2 files');
    expect(output).toContain('2. no-var — 1 error (1 fixable) in 1 file');
    expect(output).toContain(
      '   src/b.js:1:1  Unexpected console statement.\n   > 1 | console.log(2);\n\n',
    );
    expect(process.exitCode).toBe(1);
    expect(prompts.messages).toEqual([]);
  });

  it('asks to exclude fixable problems and to write the markdown report', async () => {
    prompts.confirms = [true, true];

    await runAnalyze(dir, true);

    expect(prompts.messages).toEqual([
      'Exclude auto-fixable errors/warnings? [Y]',
      'What to do with the rules?',
      `Write the report to ${ANALYSIS_REPORT_FILE}? [N]`,
    ]);
    expect(prompts.choices).toEqual([['no-console: 2 warnings in 2 files']]);
    expect(output).not.toContain('no-var');
    expect(output).toContain('Auto-fixable problems excluded: 1.');
    expect(process.exitCode).toBeUndefined();
    expect(readFileSync(path.join(dir, ANALYSIS_REPORT_FILE), 'utf8')).toContain('`no-console`');
    expect(readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).not.toContain('disable');
  });

  it('disables the chosen rules, lints again and skips the report when nothing remains', async () => {
    prompts.confirms = [true];
    prompts.actions = { 'no-console': 'disable' };

    await runAnalyze(dir, true);

    expect(readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toContain(
      "  // disable-rules\n  {\n    rules: {\n      'no-console': 'off',\n    },\n  },\n];",
    );
    expect(prompts.messages).toEqual([
      'Exclude auto-fixable errors/warnings? [Y]',
      'What to do with the rules?',
    ]);
    expect(output.match(/ESLint analysis/gu)).toHaveLength(2);
    expect(output).toMatch(
      /ESLint analysis\nNo problems found\.\nAuto-fixable problems excluded: 1\.\n/u,
    );
    expect(existsSync(path.join(dir, ANALYSIS_REPORT_FILE))).toBe(false);
  });

  it('keeps the remaining problems after disabling rules', async () => {
    prompts.confirms = [false];
    prompts.actions = { 'no-console': 'disable' };

    await runAnalyze(dir, true);

    expect(prompts.choices).toEqual([
      ['no-console: 2 warnings in 2 files', 'no-var: 1 error (1 fixable) in 1 file'],
      ['no-var: 1 error (1 fixable) in 1 file'],
    ]);
    expect(prompts.messages.at(-1)).toBe(`Write the report to ${ANALYSIS_REPORT_FILE}? [N]`);
    expect(output.split('ESLint analysis').at(-1)).not.toContain('no-console');
    expect(process.exitCode).toBe(1);
  });

  it('ignores the problems of a rule with comments and lints again', async () => {
    prompts.confirms = [false];
    prompts.actions = { 'no-console': 'ignore', 'no-var': 'disable' };

    await runAnalyze(dir, true);

    expect(readFileSync(path.join(dir, 'src/a.js'), 'utf8')).toBe(
      'var a = 1;\n// eslint-disable-next-line no-console\nconsole.log(a);\n',
    );
    expect(readFileSync(path.join(dir, 'src/b.js'), 'utf8')).toBe(
      '/* eslint-disable no-console */\nconsole.log(2);\n/* eslint-enable no-console */\n',
    );
    expect(readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toContain("'no-var': 'off'");
    expect(output.split('ESLint analysis').at(-1)).toContain('No problems found.');
    expect(process.exitCode).toBeUndefined();
  });

  it('asks again after each change until nothing changes', async () => {
    write('src/c.js', 'debugger;\n');
    write(
      'eslint.config.mjs',
      "export default [{ rules: { 'no-var': 'error', 'no-console': 'warn', 'no-debugger': 'error' } }];\n",
    );
    prompts.confirms = [false];
    prompts.rounds = [{ 'no-console': 'disable' }, { 'no-debugger': 'ignore' }, {}];

    await runAnalyze(dir, true);

    expect(prompts.choices.map((round) => round.map((choice) => choice.split(':')[0]))).toEqual([
      ['no-debugger', 'no-console', 'no-var'],
      ['no-debugger', 'no-var'],
      ['no-var'],
    ]);
    expect(output.match(/ESLint analysis/gu)).toHaveLength(3);
    expect(prompts.messages.at(-1)).toBe(`Write the report to ${ANALYSIS_REPORT_FILE}? [N]`);
    expect(process.exitCode).toBe(1);
  });

  it('fails for a missing directory', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runAnalyze(path.join(dir, 'missing'), false);

    expect(process.exitCode).toBe(1);
    expect(existsSync(path.join(dir, 'missing'))).toBe(false);
  });
});
