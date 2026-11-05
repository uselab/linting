import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkGit, findUncommittedChanges, gitAdd, gitMove } from '../../src/features/cli/git';

let dir = '';

const git = (...args: string[]): void => {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: dir, stdio: 'ignore' },
  );
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-git-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('checkGit', () => {
  it('fails outside a git repository', () => {
    expect(checkGit(dir)).toBeDefined();
  });

  it('passes in a clean repository, also from a subdirectory', () => {
    git('init', '--quiet');
    mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
    writeFileSync(path.join(dir, 'packages', 'web', 'package.json'), '{}');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'initial');

    expect(checkGit(dir)).toBeUndefined();
    expect(checkGit(path.join(dir, 'packages', 'web'))).toBeUndefined();
  });

  it('fails with modified, staged and untracked files', () => {
    git('init', '--quiet');
    writeFileSync(path.join(dir, 'modified.ts'), '');
    writeFileSync(path.join(dir, 'staged.ts'), '');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'initial');
    writeFileSync(path.join(dir, 'modified.ts'), 'changed');
    writeFileSync(path.join(dir, 'staged.ts'), 'changed');
    git('add', 'staged.ts');
    writeFileSync(path.join(dir, 'untracked.ts'), '');

    expect(findUncommittedChanges(dir)).toEqual([
      ' M modified.ts',
      'M  staged.ts',
      '?? untracked.ts',
    ]);
    const message = checkGit(dir) ?? '';
    expect(message.split('\n')).toHaveLength(4);
    for (const change of findUncommittedChanges(dir)) {
      expect(message).toContain(change);
    }
  });

  it('explains files that are staged but deleted from disk', () => {
    git('init', '--quiet');
    writeFileSync(path.join(dir, 'committed.ts'), '');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'initial');
    writeFileSync(path.join(dir, 'gone.ts'), '');
    git('add', 'gone.ts');
    rmSync(path.join(dir, 'gone.ts'));

    const message = checkGit(dir) ?? '';
    expect(message).toContain('AD gone.ts');
    expect(message.split('\n').length).toBeGreaterThan(2);
  });

  it('lists at most 10 changes', () => {
    git('init', '--quiet');
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path.join(dir, `file-${String(index).padStart(2, '0')}.ts`), '');
    }

    const message = checkGit(dir) ?? '';

    const lines = message.split('\n');
    expect(lines).toHaveLength(12);
    expect(lines.filter((line) => line.includes('.ts'))).toHaveLength(10);
  });
});

describe('gitMove', () => {
  beforeEach(() => {
    git('init', '--quiet');
    writeFileSync(path.join(dir, 'tracked.js'), 'export default [];\n');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'initial');
  });

  it('stages the rename of a tracked file', () => {
    expect(gitMove(dir, 'tracked.js', 'tracked.ts')).toBe(true);

    expect(findUncommittedChanges(dir)).toEqual(['R  tracked.js -> tracked.ts']);
  });

  it('fails for an untracked file', () => {
    writeFileSync(path.join(dir, 'untracked.js'), '');

    expect(gitMove(dir, 'untracked.js', 'untracked.ts')).toBe(false);
  });
});

describe('gitAdd', () => {
  beforeEach(() => {
    git('init', '--quiet');
  });

  it('stages a new file, also by absolute path', () => {
    writeFileSync(path.join(dir, 'new.ts'), '');

    expect(gitAdd(dir, path.join(dir, 'new.ts'))).toBe(true);

    expect(findUncommittedChanges(dir)).toEqual(['A  new.ts']);
  });

  it('fails for an ignored file', () => {
    writeFileSync(path.join(dir, '.gitignore'), 'ignored.ts\n');
    writeFileSync(path.join(dir, 'ignored.ts'), '');

    expect(gitAdd(dir, 'ignored.ts')).toBe(false);
  });
});
