import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): {
    confirms: boolean[];
    messages: string[];
    actions: string[];
    choices: string[];
  } => ({
    confirms: [],
    messages: [],
    actions: [],
    choices: [],
  }),
);

vi.mock('@clack/prompts', () => {
  const noop = (): void => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    box: (message: string, title: string) => {
      process.stdout.write(`${title}\n${message}\n`);
    },
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
  askRuleAction: async ({ ruleId, hint }: { ruleId: string; hint: string }) => {
    prompts.messages.push(`Rule: ${ruleId}`);
    prompts.choices.push(`${ruleId}: ${hint}`);
    return prompts.actions.shift() ?? 'skip';
  },
}));

const {
  ANALYSIS_REPORT_FILE,
  analyzeProblems,
  codeExcerpt,
  formatMarkdownReport,
  formatTerminalReport,
  formatTerminalReportBody,
  PARSE_ERROR_RULE,
  pickExamples,
  runAnalyze,
  summarizeRules,
} = await import('../../src/features/cli/analyze');
const { DDD_INTRO, DDD_TABLE } = await import('../../src/features/cli/ddd-section');

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
  it('picks up to 2 examples from different files first', () => {
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
      '1. no-var — 2 errors (1 fixable) in 2 files\n   - a.ts:2:1 (1)\n   - c.ts:2:1 (1)\n',
    );
    expect(report).toContain(
      '   a.ts:2:1  Unexpected var.\n     1 | const a = 1;\n   > 2 | var x = 1;',
    );
    expect(report).toContain(`2. ${PARSE_ERROR_RULE} — 1 warning in 1 file`);
    expect(
      report.endsWith(
        '\n\n2 errors (1 fixable), 1 warning in 2 rules.\n' +
          '1 problem can be fixed automatically with `npm run lint:fix`.',
      ),
    ).toBe(true);
  });

  it('repeats the summary with the excluded auto-fixable problems at the bottom', () => {
    const report = formatTerminalReport(
      analyzeProblems(
        [problem({ ruleId: 'no-var' }), problem({ ruleId: 'no-var', fixable: true })],
        readSource,
        true,
      ),
    );
    expect(report).toMatch(
      /\n\n1 error in 1 rule\.\n1 Auto-fixable problem excluded\.\n1 problem can be fixed automatically with `npm run lint:fix`\.$/u,
    );
  });

  it('repeats the summary at the bottom only when the report is taller than the terminal', () => {
    const rules = analyzeProblems([problem({ ruleId: 'a-rule' })], readSource);
    const count = (text: string): number => text.split('1 error in 1 rule.').length - 1;
    expect(count(formatTerminalReportBody(rules, undefined, 100))).toBe(1);
    expect(count(formatTerminalReportBody(rules, undefined, 5))).toBe(2);
    expect(count(formatTerminalReportBody(rules, undefined, undefined))).toBe(2);
  });

  it('hides the excluded line when nothing was excluded', () => {
    const report = formatTerminalReport(
      analyzeProblems([problem({ ruleId: 'no-var' })], readSource, true),
    );
    expect(report).not.toContain('excluded');
  });

  it('explains the hidden problems of the other rules in the focused report', () => {
    const rules = analyzeProblems(
      [
        problem({ ruleId: 'a-rule' }),
        problem({ ruleId: 'b-rule', severity: 1 }),
        problem({ ruleId: 'b-rule', severity: 1, file: 'b.ts' }),
      ],
      readSource,
    );
    const focused = formatTerminalReportBody(rules, 'a-rule');
    expect(focused).toContain('2 warnings in 1 other rule hidden; they follow after this rule.');
    expect(focused).not.toContain('b-rule');
    expect(formatTerminalReportBody(rules)).not.toContain('hidden');
    expect(formatTerminalReportBody(rules, 'b-rule')).toContain(
      '1 error in 1 other rule hidden; they follow after this rule.',
    );
  });

  it('writes the summary only at the top of the markdown', () => {
    const report = formatMarkdownReport(analysis);
    expect(report.split('in 2 rules.')).toHaveLength(2);
  });

  it('writes markdown with code fences', () => {
    const report = formatMarkdownReport(analysis);
    expect(report).toContain('## 1. `no-var`');
    expect(report).toContain(
      '2 errors (1 fixable) in 2 files:\n\n- `a.ts:2:1` (1)\n- `c.ts:2:1` (1)\n',
    );
    expect(report).toContain(
      '`a.ts:2:1` Unexpected var.\n\n```ts\n  1 | const a = 1;\n> 2 | var x = 1;',
    );
  });

  it('reports no problems', () => {
    expect(formatTerminalReport({ rules: [] })).toBe('ESLint analysis\nNo problems found.');
  });

  it('shows the position only for files with a single problem', () => {
    const report = formatMarkdownReport(
      analyzeProblems(
        [
          problem({ ruleId: 'no-var', file: 'a.ts', line: 2 }),
          problem({ ruleId: 'no-var', file: 'a.ts', line: 3 }),
          problem({ ruleId: 'no-var', file: 'c.ts', line: 2, column: 5 }),
        ],
        readSource,
      ),
    );
    expect(report).toContain('- `a.ts` (2)\n- `c.ts:2:5` (1)\n');
  });

  it('explains the project structure when there are boundary problems', () => {
    const report = formatMarkdownReport(
      analyzeProblems(
        [
          problem({ ruleId: 'boundaries/dependencies', file: 'a.ts' }),
          problem({ ruleId: 'no-var', file: 'c.ts' }),
        ],
        readSource,
      ),
    );
    expect(
      report.endsWith(`\n\n## Project structure (DDD)\n\n${DDD_INTRO}\n\n${DDD_TABLE}\n`),
    ).toBe(true);
    expect(report).toContain(
      '## 1. `boundaries/dependencies`\n\nSee [Project structure (DDD)](#project-structure-ddd).\n\n1 error in 1 file:',
    );
    expect(report).toContain('## 2. `no-var`\n\n1 error in 1 file:');
  });

  it('leaves out the project structure without boundary problems', () => {
    const report = formatMarkdownReport(analysis);
    expect(report).not.toContain('Project structure (DDD)');
  });

  it('copies the project structure from the README', () => {
    const readme = readFileSync(
      path.join(import.meta.dirname, '../../README.md'),
      'utf8',
    ).replaceAll('\r\n', '\n');
    const section = readme.slice(readme.indexOf('### Project structure (boundaries)'));
    expect(section).toContain(`\n\n${DDD_INTRO}\n\n`);
    expect(section).toContain(`\n\n${DDD_TABLE}\n\n`);
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
    prompts.actions = [];
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

  it('asks to run lint:fix and to write the markdown report, leaving out fixable problems', async () => {
    prompts.confirms = [false, true];

    await runAnalyze(dir, true);

    expect(prompts.messages).toEqual([
      'Run lint:fix? (1 problem can be fixed automatically) [Y]',
      'Rule: no-console',
      `Write the report to ${ANALYSIS_REPORT_FILE}? [Y]`,
    ]);
    expect(prompts.choices).toEqual(['no-console: 2 warnings in 2 files']);
    expect(output).not.toContain('no-var');
    expect(output).toContain('1 Auto-fixable problem excluded.');
    expect(process.exitCode).toBeUndefined();
    expect(readFileSync(path.join(dir, ANALYSIS_REPORT_FILE), 'utf8')).toContain('`no-console`');
    expect(readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).not.toContain('disable');
  });

  it('runs lint:fix first when asked', async () => {
    prompts.confirms = [true];

    await runAnalyze(dir, true);

    expect(readFileSync(path.join(dir, 'src/a.js'), 'utf8')).toBe('let a = 1;\nconsole.log(a);\n');
    expect(prompts.messages[0]).toBe('Run lint:fix? (1 problem can be fixed automatically) [Y]');
    expect(output).not.toContain('no-var');
    expect(output).toContain('no-console — 2 warnings in 2 files');
    expect(output.match(/ESLint analysis/gu)).toHaveLength(1);
  });

  it('does not ask to run lint:fix when nothing is fixable', async () => {
    write('src/a.js', 'console.log(1);\n');

    await runAnalyze(dir, true);

    expect(prompts.messages.some((message) => message.includes('lint:fix'))).toBe(false);
  });

  it('disables the chosen rule, lints again and skips the report when nothing remains', async () => {
    prompts.confirms = [false];
    prompts.actions = ['disable'];

    await runAnalyze(dir, true);

    expect(readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toContain(
      "  // disable-rules\n  {\n    rules: {\n      'no-console': 'off',\n    },\n  },\n];",
    );
    expect(prompts.messages).toEqual([
      'Run lint:fix? (1 problem can be fixed automatically) [Y]',
      'Rule: no-console',
    ]);
    expect(output.match(/ESLint analysis/gu)).toHaveLength(2);
    expect(output).toMatch(
      /ESLint analysis \(2\)\nNo problems found\.\n1 Auto-fixable problem excluded\.\n/u,
    );
    expect(existsSync(path.join(dir, ANALYSIS_REPORT_FILE))).toBe(false);
  });

  it('shows the next rule after skipping and keeps the remaining problems', async () => {
    write('src/c.js', 'debugger;\n');
    write(
      'eslint.config.mjs',
      "export default [{ rules: { 'no-console': 'warn', 'no-debugger': 'error' } }];\n",
    );
    prompts.confirms = [false];
    prompts.actions = ['disable', 'skip'];

    await runAnalyze(dir, true);

    expect(prompts.choices).toEqual([
      'no-debugger: 1 error in 1 file',
      'no-console: 2 warnings in 2 files',
    ]);
    expect(prompts.messages.at(-1)).toBe(`Write the report to ${ANALYSIS_REPORT_FILE}? [Y]`);
    expect(output.split('ESLint analysis').at(-1)).not.toContain('no-debugger');
    expect(output.split('ESLint analysis').at(-1)).toContain('no-console');
    expect(process.exitCode).toBeUndefined();
  });

  it('ignores the problems of a rule with comments and lints again', async () => {
    prompts.confirms = [false];
    prompts.actions = ['ignore'];

    await runAnalyze(dir, true);

    expect(readFileSync(path.join(dir, 'src/a.js'), 'utf8')).toBe(
      'var a = 1;\n// eslint-disable-next-line no-console\nconsole.log(a);\n',
    );
    expect(readFileSync(path.join(dir, 'src/b.js'), 'utf8')).toBe(
      '/* eslint-disable no-console */\nconsole.log(2);\n/* eslint-enable no-console */\n',
    );
    expect(output.split('ESLint analysis').at(-1)).toContain('No problems found.');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints only the report of the rule that is asked about, also after skipping', async () => {
    write('src/c.js', 'debugger;\n');
    write(
      'eslint.config.mjs',
      "export default [{ rules: { 'no-console': 'warn', 'no-debugger': 'error' } }];\n",
    );
    prompts.confirms = [false];
    prompts.actions = ['skip', 'skip'];

    await runAnalyze(dir, true);

    const [, first, second] = output.split('ESLint analysis');
    expect(output.match(/ESLint analysis/gu)).toHaveLength(2);
    expect(first).toContain('no-debugger —');
    expect(first).not.toContain('1. ');
    expect(first).toContain('\nsrc/c.js:1:1  ');
    expect(first).not.toContain('no-console —');
    expect(second).toContain('no-console —');
    expect(second).not.toContain('2. ');
    expect(second).not.toContain('no-debugger —');
  });

  it('presents the rule with the most problems first, one per cycle, until finished', async () => {
    write('src/c.js', 'debugger;\n');
    write(
      'eslint.config.mjs',
      "export default [{ rules: { 'no-var': 'error', 'no-console': 'warn', 'no-debugger': 'error' } }];\n",
    );
    prompts.confirms = [false];
    prompts.actions = ['disable', 'finish'];

    await runAnalyze(dir, true);

    expect(prompts.choices.map((choice) => choice.split(':')[0])).toEqual([
      'no-debugger',
      'no-console',
    ]);
    expect(output.match(/ESLint analysis/gu)).toHaveLength(2);
    expect(output).toContain('ESLint analysis (2)\n');
    expect(prompts.messages.at(-1)).toBe(`Write the report to ${ANALYSIS_REPORT_FILE}? [Y]`);
    expect(process.exitCode).toBeUndefined();
  });

  it('fails for a missing directory', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runAnalyze(path.join(dir, 'missing'), false);

    expect(process.exitCode).toBe(1);
    expect(existsSync(path.join(dir, 'missing'))).toBe(false);
  });
});
