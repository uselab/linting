import { existsSync, statSync } from 'node:fs';
import { collectProblems, lintProject } from './analyze';

type CheckOptions = { withWarnings?: boolean };

/** The first problem with the arguments, if any. */
const argumentError = (projectDir: string, ruleId: string | undefined): string | undefined => {
  if (!ruleId) {
    return 'Usage: uselab-linting check <rule> [dir] [--with-warnings]';
  }
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    return `Target directory does not exist: ${projectDir}`;
  }
  return undefined;
};

/** The `check` command: lists the errors of one ESLint rule (and its warnings with `--with-warnings`). Exits with 1 when there are any. */
export const runCheckRule = async (
  projectDir: string,
  ruleId: string | undefined,
  { withWarnings = false }: CheckOptions = {},
) => {
  const error = argumentError(projectDir, ruleId);
  if (error || !ruleId) {
    process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  const problems = collectProblems(
    projectDir,
    await lintProject(projectDir, { quiet: !withWarnings }),
  ).filter((problem) => problem.ruleId === ruleId);
  if (problems.length === 0) {
    process.stdout.write(`No problems for ${ruleId}.\n`);
    return;
  }
  for (const { file, line, column, message, severity } of problems) {
    process.stdout.write(
      `${file}:${line}:${column}  ${severity === 2 ? 'error' : 'warning'}  ${message}\n`,
    );
  }
  process.stdout.write(`\n${problems.length} problem(s) for ${ruleId}.\n`);
  process.exitCode = 1;
};
