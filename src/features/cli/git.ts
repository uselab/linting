import { execFileSync } from 'node:child_process';

const MAX_LISTED_CHANGES = 10;
const GIT_NOT_INSTALLED = 'git is not installed. Install git and run init in a git repository.';

type GitResult = { ok: true; output: string } | { ok: false; notInstalled: boolean };

const git = (projectDir: string, args: string[]): GitResult => {
  try {
    const output = execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { ok: true, output };
  } catch (error) {
    const notInstalled = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    return { ok: false, notInstalled };
  }
};

const toLines = (output: string): string[] =>
  output.split('\n').filter((line) => line.trim() !== '');

/** Renames a file with `git mv`, so the rename is staged. Returns false when git can't move it. */
export const gitMove = (projectDir: string, from: string, to: string): boolean =>
  git(projectDir, ['mv', '--', from, to]).ok;

/** Stages the file with `git add`. Returns false when git can't add it (e.g. an ignored file). */
export const gitAdd = (projectDir: string, file: string): boolean =>
  git(projectDir, ['add', '--', file]).ok;

/** The lines of `git status --porcelain`, including untracked files. */
export const findUncommittedChanges = (projectDir: string): string[] => {
  const status = git(projectDir, ['status', '--porcelain']);
  return status.ok ? toLines(status.output) : [];
};

const uncommittedChangesMessage = (changes: string[]): string => {
  const listed = changes.slice(0, MAX_LISTED_CHANGES).map((line) => `  ${line}`);
  if (changes.length > MAX_LISTED_CHANGES) {
    listed.push(`  ... and ${changes.length - MAX_LISTED_CHANGES} more`);
  }
  const hints = changes.some((line) => line.startsWith('AD '))
    ? [
        'Files marked AD are staged but deleted from disk, so editors often do not show them.',
        'Unstage them with `git reset -- <file>` (or `git reset` to unstage everything).',
      ]
    : [];
  return [
    'There are uncommitted changes. Commit or stash them before running init:',
    ...listed,
    ...hints,
  ].join('\n');
};

/**
 * Checks that the project is inside a git repository without uncommitted changes.
 * Returns the error message, or `undefined` when init can run.
 */
export const checkGit = (projectDir: string): string | undefined => {
  const workTree = git(projectDir, ['rev-parse', '--is-inside-work-tree']);
  if (!workTree.ok && workTree.notInstalled) {
    return GIT_NOT_INSTALLED;
  }
  if (!workTree.ok || workTree.output.trim() !== 'true') {
    return `${projectDir} is not inside a git repository. Run init in a git repository.`;
  }
  const status = git(projectDir, ['status', '--porcelain']);
  if (!status.ok) {
    return `Could not read the git status of ${projectDir}.`;
  }
  const changes = toLines(status.output);
  return changes.length === 0 ? undefined : uncommittedChangesMessage(changes);
};
