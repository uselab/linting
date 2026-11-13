import { styleText } from 'node:util';
import * as clack from '@clack/prompts';
import { findUncommittedChanges, gitCommit, gitSnapshot, isGitRepository } from './git';
import { confirm, unwrap } from './prompts';

/** Offers to commit the changes the CLI makes, and requires a clean working tree before the first. */
export type CommitOffer = {
  /**
   * Runs a step that may change files. Before the first change of the CLI, the working tree must be
   * clean (see `ensureClean`). Afterwards, when git reports that the step changed something,
   * offers to commit it with a default message based on `summary`, which may be a function that is
   * called once the change has run.
   */
  step: <T>(summary: string | (() => string), change: () => Promise<T> | T) => Promise<T>;
  /** Like `step`, for changes made already: call the returned function once they are made. */
  begin: () => (summary: string) => Promise<void>;
  /** Requires a clean working tree now, e.g. before asking something that precedes a change. */
  ensureClean: () => Promise<void>;
};

const COMMIT_MESSAGE = 'Commit message';
const SUBMIT_HINT = styleText('dim', '(multiline: press Enter twice to submit)');
const REQUIRED_MESSAGE = 'Enter a commit message.';

const messageLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/^-\s+/, '').trim())
    .filter((line) => line !== '');

/** The default commit message: the declined lines plus the new one, dash-prefixed when several. */
export const commitMessage = (pending: string[], summary: string): string => {
  const lines = messageLines([...pending, summary].join('\n'));
  return (lines.length > 1 ? lines.map((line) => `- ${line}`) : lines).join('\n');
};

const requireMessage = (value: string | undefined): string | undefined =>
  value?.trim() ? undefined : REQUIRED_MESSAGE;

const sameSnapshot = (before: Map<string, string>, after: Map<string, string>): boolean =>
  before.size === after.size && [...before].every(([file, hash]) => after.get(file) === hash);

/** Requires the user to commit the existing changes; exits when they decline or it fails. */
const commitExistingChanges = async (projectDir: string): Promise<void> => {
  const message = (): Promise<string | symbol> =>
    clack.multiline({
      message: `${COMMIT_MESSAGE} (required) ${SUBMIT_HINT}`,
      validate: requireMessage,
    });
  const accepted = await confirm(
    `There are uncommitted changes. Commit them first to continue? ${styleText('dim', '(required: the CLI only changes a clean working tree)')}`,
  );
  if (!accepted) {
    clack.cancel('Commit or stash your changes and run again.');
    process.exit(0);
  }
  const text = unwrap(await message());
  if (!gitCommit(projectDir, text.trim())) {
    clack.cancel('Could not commit the changes. Commit them yourself and run again.');
    process.exit(1);
  }
  clack.log.success('Committed the existing changes.');
};

export const disabledCommitOffer: CommitOffer = {
  step: async (_summary, change) => change(),
  begin: () => async () => {},
  ensureClean: async () => {},
};

/**
 * Creates the commit offer shared by the steps of one run. It is disabled (steps just run) when the
 * terminal isn't interactive or the directory isn't in a git repository. `clean` states the working
 * tree is known to be clean (init checks that before it starts).
 */
export const createCommitOffer = (
  projectDir: string,
  interactive: boolean,
  { clean = false }: { clean?: boolean } = {},
): CommitOffer => {
  if (!interactive || !isGitRepository(projectDir)) {
    return disabledCommitOffer;
  }
  let verifiedClean = clean;
  let pending: string[] = [];

  const ensureClean = async (): Promise<void> => {
    if (verifiedClean) {
      return;
    }
    if (findUncommittedChanges(projectDir).length > 0) {
      await commitExistingChanges(projectDir);
    }
    verifiedClean = true;
  };

  const offer = async (summary: string, before: Map<string, string> | undefined) => {
    const after = gitSnapshot(projectDir);
    if (!before || !after || sameSnapshot(before, after)) {
      return;
    }
    const defaultMessage = commitMessage(pending, summary);
    if (await confirm('Do you want me to commit the changes I made?')) {
      const text = unwrap(
        await clack.multiline({
          message: `${COMMIT_MESSAGE} ${SUBMIT_HINT}`,
          initialValue: defaultMessage,
          validate: requireMessage,
        }),
      );
      if (gitCommit(projectDir, text.trim())) {
        pending = [];
        clack.log.success('Committed the changes.');
        return;
      }
      clack.log.warn('Could not commit the changes; they stay uncommitted.');
      pending = messageLines(text);
      return;
    }
    pending = messageLines(defaultMessage);
  };

  const begin = () => {
    const before = gitSnapshot(projectDir);
    return (summary: string) => offer(summary, before);
  };

  return {
    begin,
    ensureClean,
    step: async (summary, change) => {
      await ensureClean();
      const finish = begin();
      const result = await change();
      await finish(typeof summary === 'function' ? summary() : summary);
      return result;
    },
  };
};
