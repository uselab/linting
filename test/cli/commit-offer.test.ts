import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): {
    multilines: (string | undefined)[];
    confirms: boolean[];
    asked: { message: string; initialValue?: string; validate: (v?: string) => unknown }[];
    confirmed: string[];
    cancelled: string[];
  } => ({ multilines: [], confirms: [], asked: [], confirmed: [], cancelled: [] }),
);

vi.mock('@clack/prompts', () => ({
  isCancel: () => false,
  cancel: (message: string) => prompts.cancelled.push(message),
  log: { success: () => {}, warn: () => {}, info: () => {} },
  multiline: async (options: (typeof prompts.asked)[number]) => {
    prompts.asked.push(options);
    return prompts.multilines.shift() ?? options.initialValue;
  },
  confirm: async ({ message }: { message: string }) => {
    prompts.confirmed.push(message);
    return prompts.confirms.shift() ?? true;
  },
}));

const { commitMessage, createCommitOffer } = await import('../../src/features/cli/commit-offer');

let dir = '';

const git = (...args: string[]): string =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=t@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: dir, encoding: 'utf8' },
  );

const write = (file: string, content: string): void => writeFileSync(path.join(dir, file), content);

const subjects = (): string[] =>
  git('log', '--format=%B%x00')
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-commit-'));
  git('init', '--quiet');
  write('a.txt', 'a');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'initial');
  Object.assign(prompts, { multilines: [], confirms: [], asked: [], confirmed: [], cancelled: [] });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('commitMessage', () => {
  it('uses the summary as is when it is the only line', () => {
    expect(commitMessage([], 'Added x')).toBe('Added x');
  });

  it('prepends a dash to every line when there are several', () => {
    expect(commitMessage(['Added x'], 'Added y')).toBe('- Added x\n- Added y');
    expect(commitMessage(['- Added x', 'Added y'], 'Added z')).toBe(
      '- Added x\n- Added y\n- Added z',
    );
  });
});

describe('createCommitOffer', () => {
  it('only runs the step when not interactive', async () => {
    const offer = createCommitOffer(dir, false);
    await offer.step('Changed a', () => write('a.txt', 'changed'));
    expect(prompts.asked).toHaveLength(0);
  });

  it('commits a changing step with the default message', async () => {
    const offer = createCommitOffer(dir, true);
    await offer.step('Changed a', () => write('a.txt', 'changed'));
    expect(prompts.asked[0]?.initialValue).toBe('Changed a');
    expect(prompts.confirmed).toEqual(['Do you want me to commit the changes I made?']);
    expect(subjects()[0]).toBe('Changed a');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('does not ask when the step changed nothing', async () => {
    const offer = createCommitOffer(dir, true);
    await offer.step('Nothing', () => {});
    expect(prompts.asked).toHaveLength(0);
  });

  it('carries declined messages over, also for a file that was already modified', async () => {
    const offer = createCommitOffer(dir, true);
    prompts.confirms.push(false);
    await offer.step('Changed a once', () => write('a.txt', 'one'));
    await offer.step('Changed a twice', () => write('a.txt', 'two'));
    expect(prompts.asked[0]?.initialValue).toBe('- Changed a once\n- Changed a twice');
    expect(subjects()[0]).toBe('- Changed a once\n- Changed a twice');
    await offer.step('Changed a again', () => write('a.txt', 'three'));
    expect(prompts.asked[1]?.initialValue).toBe('Changed a again');
  });

  it('requires a message', async () => {
    const offer = createCommitOffer(dir, true);
    await offer.step('Changed a', () => write('a.txt', 'one'));
    const validate = prompts.asked[0]?.validate;
    expect(validate?.('  ')).toBeDefined();
    expect(validate?.('Text')).toBeUndefined();
  });

  it('requires committing existing changes before the first change', async () => {
    write('a.txt', 'dirty');
    const offer = createCommitOffer(dir, true);
    prompts.multilines.push('Existing work');
    prompts.confirms.push(true, false);
    await offer.step('Added b', () => write('b.txt', 'b'));
    expect(prompts.asked[0]).toMatchObject({ message: expect.stringContaining('(required)') });
    expect(prompts.asked[0]?.initialValue).toBeUndefined();
    expect(prompts.asked[0]?.validate('')).toBeDefined();
    expect(subjects()[0]).toBe('Existing work');
    expect(git('status', '--porcelain')).toContain('b.txt');
  });

  it('does not ask again once the working tree was verified clean', async () => {
    const offer = createCommitOffer(dir, true);
    prompts.confirms.push(false);
    await offer.step('Changed a', () => write('a.txt', 'one'));
    await offer.step('Added b', () => write('b.txt', 'b'));
    expect(prompts.confirmed).not.toContain(expect.stringContaining('uncommitted'));
  });

  it('stops without changing anything when the existing changes are not committed', async () => {
    write('a.txt', 'dirty');
    const offer = createCommitOffer(dir, true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    prompts.confirms.push(false);
    const change = vi.fn();
    await expect(offer.step('Changed', change)).rejects.toThrow('exit');
    expect(change).not.toHaveBeenCalled();
    expect(prompts.cancelled).toHaveLength(1);
    exit.mockRestore();
  });
});
