import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_LISTED_CHANGES = 10;
const GIT_NOT_INSTALLED = 'git is not installed. Install git and run init in a git repository.';

type GitResult = { ok: true; output: string } | { ok: false; notInstalled: boolean };

const git = (projectDir: string, args: string[], input?: string): GitResult => {
  try {
    const output = execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      input,
      maxBuffer: 64 * 1024 * 1024,
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

/** Whether the directory is inside a git work tree (and git is installed). */
export const isGitRepository = (projectDir: string): boolean => {
  const workTree = git(projectDir, ['rev-parse', '--is-inside-work-tree']);
  return workTree.ok && workTree.output.trim() === 'true';
};

/** Stages everything and commits it with the message. Returns false when the commit fails. */
export const gitCommit = (projectDir: string, message: string): boolean =>
  git(projectDir, ['add', '-A']).ok && git(projectDir, ['commit', '-m', message]).ok;

/** The paths of `git status --porcelain -z`; a rename contributes its new and old path. */
const parseStatusPaths = (output: string): { status: string; path: string }[] => {
  const entries: { status: string; path: string }[] = [];
  const tokens = output.split('\0');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token.length > 3) {
      const status = token.slice(0, 2);
      entries.push({ status, path: token.slice(3) });
      if (status.includes('R') || status.includes('C')) {
        index += 1;
        entries.push({ status, path: tokens[index] ?? '' });
      }
    }
  }
  return entries;
};

/**
 * A fingerprint of every uncommitted change: the status and content hash per path. Comparing two
 * snapshots tells whether something changed in between, also in a file that was already modified.
 * Returns undefined when git can't tell.
 */
export const gitSnapshot = (projectDir: string): Map<string, string> | undefined => {
  const root = git(projectDir, ['rev-parse', '--show-toplevel']);
  const status = git(projectDir, ['status', '--porcelain', '-z', '--untracked-files=all']);
  if (!root.ok || !status.ok) {
    return undefined;
  }
  const repoRoot = root.output.trim();
  const entries = parseStatusPaths(status.output).filter(({ path: file }) => file !== '');
  const isFile = (file: string): boolean => {
    const absolute = path.join(repoRoot, file);
    return existsSync(absolute) && statSync(absolute).isFile();
  };
  const files = entries.filter(({ path: file }) => isFile(file));
  const hashes = git(
    repoRoot,
    ['hash-object', '--stdin-paths'],
    files.map(({ path: file }) => `${file}\n`).join(''),
  );
  const hashLines = hashes.ok ? toLines(hashes.output) : [];
  const hashOf = new Map(files.map(({ path: file }, index) => [file, hashLines[index] ?? '']));
  return new Map(
    entries.map(({ status: code, path: file }) => [file, `${code}:${hashOf.get(file) ?? ''}`]),
  );
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
