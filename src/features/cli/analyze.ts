import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import * as clack from '@clack/prompts';
import type { ESLint, Linter } from 'eslint';
import { DDD_REFERENCE, dddSectionLines, isBoundaryRule } from './ddd-section';
import { createCommitOffer, type CommitOffer } from './commit-offer';
import { ownVersion } from './own-version';
import { confirm } from './prompts';
import { applyRuleAction } from './rule-actions';
import type { RuleChoice } from './rule-actions-prompt';

export const ANALYSIS_REPORT_FILE = 'LINT-ANALYSIS.md';
export const PARSE_ERROR_RULE = '(parse error)';
export const MAX_EXAMPLES = 2;
const ESLINT_CACHE = 'node_modules/.cache/eslint/';
const MAX_LINE_LENGTH = 160;

/** A single reported problem, with the file relative to the project directory. */
export type Problem = {
  ruleId: string;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 1 | 2;
  fixable: boolean;
};

/** A code excerpt of a problem: the offending line with one line of context around it. */
export type Example = {
  problem: Problem;
  lines: { number: number; text: string; offending: boolean }[];
};

/** A file with problems, with the position of its first problem. */
export type FileCount = { file: string; count: number; line: number; column: number };

export type RuleSummary = {
  ruleId: string;
  errors: number;
  fixableErrors: number;
  warnings: number;
  fixableWarnings: number;
  files: FileCount[];
  examples: Example[];
};

export type Analysis = {
  rules: RuleSummary[];
  /** Number of auto-fixable problems left out, when they were excluded. */
  excludedFixable?: number;
};

/** Reads the source lines of a project file. */
export type SourceReader = (file: string) => string[] | undefined;

const relativePath = (projectDir: string, file: string): string =>
  path.relative(projectDir, file).split(path.sep).join('/');

const toProblem = (file: string, message: Linter.LintMessage): Problem => ({
  ruleId: message.ruleId ?? PARSE_ERROR_RULE,
  file,
  line: message.line,
  column: message.column,
  message: message.message,
  severity: message.severity === 2 ? 2 : 1,
  fixable: message.fix !== undefined,
});

/** The errors and warnings of the lint results, with paths relative to the project directory. */
export const collectProblems = (projectDir: string, results: ESLint.LintResult[]): Problem[] =>
  results.flatMap(({ filePath, messages }) =>
    messages
      .filter(({ severity }) => severity > 0)
      .map((message) => toProblem(relativePath(projectDir, filePath), message)),
  );

const clip = (text: string, column: number): string => {
  if (text.length <= MAX_LINE_LENGTH) {
    return text;
  }
  const start = Math.max(
    0,
    Math.min(column - 1 - MAX_LINE_LENGTH / 2, text.length - MAX_LINE_LENGTH),
  );
  const end = start + MAX_LINE_LENGTH;
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
};

/** The offending line of the problem with one line of context before and after it. */
export const codeExcerpt = (problem: Problem, source: string[]): Example => {
  const first = Math.max(1, problem.line - 1);
  const last = Math.min(source.length, problem.line + 1);
  const lines = [];
  for (let number = first; number <= last; number += 1) {
    const text = clip((source[number - 1] ?? '').trimEnd(), problem.column);
    lines.push({ number, text, offending: number === problem.line });
  }
  return { problem, lines };
};

const excerptKey = ({ lines }: Example): string => lines.map(({ text }) => text.trim()).join('\n');

const groupBy = (problems: Problem[], key: (problem: Problem) => string) => {
  const groups = new Map<string, Problem[]>();
  for (const problem of problems) {
    groups.set(key(problem), [...(groups.get(key(problem)) ?? []), problem]);
  }
  return groups;
};

/** Interleaves the problems per file, so consecutive problems come from different files. */
const roundRobin = (problems: Problem[]): Problem[] => {
  const byFile = groupBy(problems, ({ file }) => file);
  const longest = Math.max(0, ...[...byFile.values()].map(({ length }) => length));
  return Array.from({ length: longest }, (_, index) =>
    [...byFile.values()].flatMap((list) => list.slice(index, index + 1)),
  ).flat();
};

/**
 * Up to {@link MAX_EXAMPLES} excerpts with different code, preferring problems without an autofix
 * and problems from different files.
 */
export const pickExamples = (problems: Problem[], readSource: SourceReader): Example[] => {
  const candidates = [
    ...roundRobin(problems.filter(({ fixable }) => !fixable)),
    ...roundRobin(problems.filter(({ fixable }) => fixable)),
  ];
  const examples = new Map<string, Example>();
  for (const problem of candidates) {
    const source = readSource(problem.file);
    const example = source && problem.line > 0 ? codeExcerpt(problem, source) : undefined;
    if (example && !examples.has(excerptKey(example))) {
      examples.set(excerptKey(example), example);
    }
    if (examples.size >= MAX_EXAMPLES) {
      break;
    }
  }
  return [...examples.values()];
};

const count = (problems: Problem[], severity: 1 | 2, fixable?: boolean): number =>
  problems.filter(
    (problem) =>
      problem.severity === severity && (fixable === undefined || problem.fixable === fixable),
  ).length;

/** The files with problems, most problems first, then by path. */
const fileCounts = (problems: Problem[]): FileCount[] =>
  [...groupBy(problems, ({ file }) => file)]
    .map(([file, list]) => ({
      file,
      count: list.length,
      line: list[0]?.line ?? 0,
      column: list[0]?.column ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

const summarizeRule = (
  ruleId: string,
  problems: Problem[],
  readSource: SourceReader,
): RuleSummary => ({
  ruleId,
  errors: count(problems, 2),
  fixableErrors: count(problems, 2, true),
  warnings: count(problems, 1),
  fixableWarnings: count(problems, 1, true),
  files: fileCounts(problems),
  examples: pickExamples(problems, readSource),
});

const rankKey = (rule: RuleSummary): number[] => [
  rule.errors - rule.fixableErrors,
  rule.warnings - rule.fixableWarnings,
  rule.fixableErrors,
  rule.fixableWarnings,
];

/**
 * Orders rules by relevance: errors without an autofix, then warnings without an autofix, then
 * auto-fixable errors, then auto-fixable warnings (all by count), then by rule id.
 */
export const compareRules = (a: RuleSummary, b: RuleSummary): number => {
  const keyA = rankKey(a);
  const keyB = rankKey(b);
  const difference = keyA.map((value, index) => (keyB[index] ?? 0) - value).find((d) => d !== 0);
  return difference ?? a.ruleId.localeCompare(b.ruleId);
};

/** Groups the problems per rule and orders the rules by relevance. */
export const summarizeRules = (problems: Problem[], readSource: SourceReader): RuleSummary[] =>
  [...groupBy(problems, ({ ruleId }) => ruleId)]
    .map(([ruleId, list]) => summarizeRule(ruleId, list, readSource))
    .sort(compareRules);

/** Analyzes the problems, optionally leaving out the auto-fixable ones. */
export const analyzeProblems = (
  problems: Problem[],
  readSource: SourceReader,
  excludeFixable = false,
): Analysis => {
  if (!excludeFixable) {
    return { rules: summarizeRules(problems, readSource) };
  }
  const reported = problems.filter(({ fixable }) => !fixable);
  return {
    rules: summarizeRules(reported, readSource),
    excludedFixable: problems.length - reported.length,
  };
};

const plural = (value: number, word: string): string => `${value} ${word}${value === 1 ? '' : 's'}`;

const withFixable = (value: number, fixable: number, word: string): string =>
  `${plural(value, word)}${fixable > 0 ? ` (${fixable} fixable)` : ''}`;

/** E.g. `12 errors (4 fixable), 3 warnings`. */
export const describeCounts = (rule: Omit<RuleSummary, 'ruleId' | 'files' | 'examples'>): string =>
  [
    rule.errors > 0 ? withFixable(rule.errors, rule.fixableErrors, 'error') : undefined,
    rule.warnings > 0 ? withFixable(rule.warnings, rule.fixableWarnings, 'warning') : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(', ');

const totals = (rules: RuleSummary[]) => ({
  errors: rules.reduce((sum, rule) => sum + rule.errors, 0),
  fixableErrors: rules.reduce((sum, rule) => sum + rule.fixableErrors, 0),
  warnings: rules.reduce((sum, rule) => sum + rule.warnings, 0),
  fixableWarnings: rules.reduce((sum, rule) => sum + rule.fixableWarnings, 0),
});

const summaryLines = ({ rules, excludedFixable = 0 }: Analysis): string[] => {
  const lines =
    rules.length === 0
      ? ['No problems found.']
      : [`${describeCounts(totals(rules))} in ${plural(rules.length, 'rule')}.`];
  if (excludedFixable > 0) {
    lines.push(`${plural(excludedFixable, 'Auto-fixable problem')} excluded.`);
  }
  return lines;
};

/** Explains which problems of the other rules are hidden in the focused report. */
const hiddenLines = ({ rules }: Analysis, focus: string | undefined): string[] => {
  const others = rules.filter(({ ruleId }) => ruleId !== focus);
  return focus === undefined || others.length === 0
    ? []
    : [
        `${describeCounts(totals(others))} in ${plural(others.length, 'other rule')} hidden; they follow after this rule.`,
      ];
};

const fixHint = (analysis: Analysis): string | undefined => {
  const { fixableErrors, fixableWarnings } = totals(analysis.rules);
  const fixable = fixableErrors + fixableWarnings + (analysis.excludedFixable ?? 0);
  return fixable > 0
    ? `${plural(fixable, 'problem')} can be fixed automatically with \`npm run lint:fix\`.`
    : undefined;
};

const ruleHeading = (rule: RuleSummary): string =>
  `${styleText(rule.errors > 0 ? 'red' : 'yellow', rule.ruleId)} — ${describeCounts(rule)} in ${plural(rule.files.length, 'file')}`;

/** The file, with the position of the problem when it has only one. */
const fileLocation = ({ file, count: problems, line, column }: FileCount): string =>
  problems === 1 ? `${file}:${line}:${column}` : file;

const fileList = (rule: RuleSummary): string[] =>
  rule.files.map((entry) => `${fileLocation(entry)} (${entry.count})`);

const location = ({ problem }: Example): string =>
  `${problem.file}:${problem.line}:${problem.column}`;

const numberedLines = ({ lines }: Example): string[] => {
  const width = String(lines.at(-1)?.number ?? 0).length;
  return lines.map(({ number, text, offending }) =>
    `${offending ? '>' : ' '} ${String(number).padStart(width)} | ${text}`.trimEnd(),
  );
};

export const TERMINAL_REPORT_TITLE = 'ESLint analysis';

/** Whether the top of the report would scroll out of view. */
const repeatsSummary = (reportLines: number, rows: number | undefined): boolean =>
  rows === undefined || reportLines > rows;

/**
 * The analysis as plain text for the terminal, without the title. With `focus`, only that rule is
 * listed, without a number or indentation. The summary is repeated at the bottom when the report
 * is taller than the terminal (`rows`), or when the height is unknown.
 */
export const formatTerminalReportBody = (
  analysis: Analysis,
  focus?: string,
  rows: number | undefined = process.stdout.rows,
): string => {
  const lines = [...summaryLines(analysis), ...hiddenLines(analysis, focus)];
  const focused = focus !== undefined;
  const indent = focused ? '' : '   ';
  const shown = [...analysis.rules.entries()].filter(
    ([, { ruleId }]) => !focused || ruleId === focus,
  );
  for (const [index, rule] of shown) {
    lines.push('', focused ? ruleHeading(rule) : `${index + 1}. ${ruleHeading(rule)}`);
    lines.push(...fileList(rule).map((file) => `${indent}- ${file}`));
    for (const example of rule.examples) {
      lines.push('', `${indent}${location(example)}  ${example.problem.message}`);
      lines.push(...numberedLines(example).map((line) => styleText('dim', `${indent}${line}`)));
    }
  }
  const hint = fixHint(analysis);
  const footer = [
    ...(analysis.rules.length > 0 && repeatsSummary(lines.length, rows)
      ? [...summaryLines(analysis), ...hiddenLines(analysis, focus)]
      : []),
    ...(hint ? [hint] : []),
  ];
  return [...lines, ...(footer.length > 0 ? ['', ...footer] : [])].join('\n');
};

/** The analysis as plain text for the terminal. */
export const formatTerminalReport = (analysis: Analysis): string =>
  `${TERMINAL_REPORT_TITLE}\n${formatTerminalReportBody(analysis)}`;

/**
 * Prints the report: interactively in a bordered box (numbered after the first report), so each
 * report stands out as one block when scrolling back, showing only the `focus` rule; otherwise as
 * plain text with all rules.
 */
const printReport = (
  analysis: Analysis,
  { interactive, run, focus }: { interactive: boolean; run: number; focus?: string },
): void => {
  if (!interactive) {
    process.stdout.write(`\n${formatTerminalReport(analysis)}\n\n`);
    return;
  }
  const title = run > 1 ? `${TERMINAL_REPORT_TITLE} (${run})` : TERMINAL_REPORT_TITLE;
  clack.box(formatTerminalReportBody(analysis, focus), title, {
    width: 'auto',
    contentPadding: 2,
  });
};

const fenceLanguage = (file: string): string => path.extname(file).slice(1);

/** The analysis as a markdown document. */
export const formatMarkdownReport = (analysis: Analysis): string => {
  const lines = ['# ESLint analysis', '', ...summaryLines(analysis)];
  for (const [index, rule] of analysis.rules.entries()) {
    lines.push(
      '',
      `## ${index + 1}. \`${rule.ruleId}\``,
      '',
      ...(isBoundaryRule(rule.ruleId) ? [DDD_REFERENCE, ''] : []),
      describeCounts(rule) + ` in ${plural(rule.files.length, 'file')}:`,
      '',
      ...rule.files.map((entry) => `- \`${fileLocation(entry)}\` (${entry.count})`),
    );
    for (const example of rule.examples) {
      lines.push('', `\`${location(example)}\` ${example.problem.message}`, '');
      lines.push(`\`\`\`${fenceLanguage(example.problem.file)}`, ...numberedLines(example), '```');
    }
  }
  const hint = fixHint(analysis);
  const ddd = analysis.rules.some(({ ruleId }) => isBoundaryRule(ruleId))
    ? ['', ...dddSectionLines()]
    : [];
  return `${[...lines, ...(hint ? ['', hint] : []), ...ddd].join('\n')}\n`;
};

/** Reads (and caches) the source lines of the project files. */
export const fileSourceReader = (projectDir: string): SourceReader => {
  const sources = new Map<string, string[] | undefined>();
  return (file) => {
    if (!sources.has(file)) {
      const absolute = path.join(projectDir, file);
      const exists = existsSync(absolute) && statSync(absolute).isFile();
      sources.set(
        file,
        exists
          ? readFileSync(absolute, 'utf8')
              .replace(/\r?\n$/u, '')
              .split(/\r?\n/u)
          : undefined,
      );
    }
    return sources.get(file);
  };
};

/** Lints the whole project like the `lint` script (`eslint .` with its cache). */
export const lintProject = async (
  projectDir: string,
  fix = false,
): Promise<ESLint.LintResult[]> => {
  const { ESLint: Linter } = await import('eslint');
  const eslint = new Linter({
    cwd: projectDir,
    cache: true,
    cacheLocation: ESLINT_CACHE,
    warnIgnored: false,
    fix,
  });
  const results = await eslint.lintFiles(['.']);
  if (fix) {
    await Linter.outputFixes(results);
  }
  return results;
};

const lintWithSpinner = async (projectDir: string, interactive: boolean, fix: boolean) => {
  if (!interactive) {
    return lintProject(projectDir);
  }
  const spinner = clack.spinner();
  spinner.start(fix ? 'Running ESLint with --fix' : 'Running ESLint');
  try {
    const results = await lintProject(projectDir, fix);
    spinner.stop('ESLint finished');
    return results;
  } catch (error) {
    spinner.stop('ESLint failed');
    throw error;
  }
};

const offerMarkdownReport = async (
  projectDir: string,
  analysis: Analysis,
  commits: CommitOffer,
): Promise<void> => {
  if (analysis.rules.length === 0) {
    return;
  }
  if (await confirm(`Write the report to ${ANALYSIS_REPORT_FILE}?`)) {
    await commits.step(`Added ${ANALYSIS_REPORT_FILE}`, () => {
      writeFileSync(path.join(projectDir, ANALYSIS_REPORT_FILE), formatMarkdownReport(analysis));
      clack.log.success(`Wrote ${ANALYSIS_REPORT_FILE}.`);
    });
  }
};

const ruleChoice = ({ rules }: Analysis, skipped: ReadonlySet<string>): RuleChoice | undefined => {
  const rule = rules.find(({ ruleId }) => ruleId !== PARSE_ERROR_RULE && !skipped.has(ruleId));
  return rule
    ? {
        ruleId: rule.ruleId,
        hint: `${describeCounts(rule)} in ${plural(rule.files.length, 'file')}`,
      }
    : undefined;
};

const isMissingDirectory = (projectDir: string): boolean => {
  if (existsSync(projectDir) && statSync(projectDir).isDirectory()) {
    return false;
  }
  process.stderr.write(`Target directory does not exist: ${projectDir}\n`);
  process.exitCode = 1;
  return true;
};

type AnalyzeRun = { analysis: Analysis; reported: Problem[] };

type Print = (analysis: Analysis, focus?: string) => void;

/**
 * Offers the top rule one at a time, printing only that rule's report first and linting again
 * after each change, until finished. Without a rule to offer after a change, prints the full report.
 */
const handleRules = async (
  projectDir: string,
  first: AnalyzeRun,
  {
    analyze,
    print,
    commits,
  }: { analyze: () => Promise<AnalyzeRun>; print: Print; commits: CommitOffer },
): Promise<AnalyzeRun> => {
  const skipped = new Set<string>();
  let current = first;
  let choice = ruleChoice(current.analysis, skipped);
  if (!choice) {
    print(current.analysis);
  }
  while (choice) {
    print(current.analysis, choice.ruleId);
    const outcome = await applyRuleAction(projectDir, choice, {
      problems: current.reported,
      commits,
    });
    if (outcome === 'finished') {
      break;
    }
    if (outcome === 'skipped') {
      skipped.add(choice.ruleId);
    } else {
      current = await analyze();
    }
    choice = ruleChoice(current.analysis, skipped);
    if (!choice && outcome === 'changed') {
      print(current.analysis);
    }
  }
  return current;
};

/**
 * The `analyze` command: lints the project and prints the rules with problems, ordered by
 * relevance, with code excerpts. Interactively, it offers the top rule at a time to disable or
 * ignore its problems with comments (linting again), or to edit the ignores, then offers to write
 * the report to markdown. Exits with 1 when the (final)
 * report contains errors. `intro: false` skips the intro, when run at the end of init.
 */
export const runAnalyze = async (
  projectDir: string,
  interactive: boolean,
  { intro = true, commits }: { intro?: boolean; commits?: CommitOffer } = {},
): Promise<void> => {
  if (isMissingDirectory(projectDir)) {
    return;
  }
  if (interactive && intro) {
    clack.intro(`@uselab/linting@${ownVersion()} analyze`);
  }
  const commitOffer = commits ?? createCommitOffer(projectDir, interactive);
  // Auto-fixable problems are left out interactively; `lint:fix` handles them.
  const excludeFixable = interactive;
  let run = 0;
  const lintAndCollect = async (fix: boolean) =>
    collectProblems(projectDir, await lintWithSpinner(projectDir, interactive, fix));
  const lintProblems = async (fix: boolean) =>
    fix ? commitOffer.step('Ran lint:fix', () => lintAndCollect(true)) : lintAndCollect(false);
  const offerFix = async (problems: Problem[]): Promise<boolean> => {
    const fixable = problems.filter((problem) => problem.fixable).length;
    return (
      interactive &&
      run === 0 &&
      fixable > 0 &&
      (await confirm(`Run lint:fix? (${plural(fixable, 'problem')} can be fixed automatically)`))
    );
  };
  const analyze = async () => {
    const linted = await lintProblems(false);
    const problems = (await offerFix(linted)) ? await lintProblems(true) : linted;
    const analysis = analyzeProblems(problems, fileSourceReader(projectDir), excludeFixable);
    const reported = excludeFixable ? problems.filter(({ fixable }) => !fixable) : problems;
    return { analysis, reported };
  };
  const print: Print = (analysis, focus) => {
    run += 1;
    printReport(analysis, { interactive, run, focus });
  };
  let current = await analyze();
  if (interactive) {
    current = await handleRules(projectDir, current, { analyze, print, commits: commitOffer });
    await offerMarkdownReport(projectDir, current.analysis, commitOffer);
    clack.outro('Done.');
  } else {
    print(current.analysis);
  }
  if (totals(current.analysis.rules).errors > 0) {
    process.exitCode = 1;
  }
};
