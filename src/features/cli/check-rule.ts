import { existsSync, statSync } from 'node:fs';
import { collectProblems, lintProject } from './analyze';

/** The `check` command: lists the problems of one ESLint rule. Exits with 1 when there are any. */
export const runCheckRule = async (projectDir: string, ruleId: string | undefined) => {
  if (!ruleId) {
    process.stderr.write('Usage: uselab-linting check <rule> [dir]\n');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    process.stderr.write(`Target directory does not exist: ${projectDir}\n`);
    process.exitCode = 1;
    return;
  }
  const problems = collectProblems(projectDir, await lintProject(projectDir)).filter(
    (problem) => problem.ruleId === ruleId,
  );
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
