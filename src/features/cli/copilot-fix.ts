import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import promptTemplate from './copilot-fix-prompt.json';

const SAFE_RULE_ID = /^[\w@/.-]+$/u;
/** Paths that can be put in the quoted `--allow-tool` value without escaping. */
const SAFE_PATH = /^[\w@/.+-]+$/u;
const MESSAGE_DIR = 'node_modules/.cache/uselab-linting';
const MAX_ALLOW_LENGTH = 6000;
/** Pre-approves the check command (any rule) so Copilot can verify its work without asking. Copilot names the command `npx uselab-linting`, so a longer prefix never matches. */
const ALLOW_CHECK = 'shell(npx uselab-linting:*)';

export const COPILOT_MISSING_MESSAGE =
  'GitHub Copilot CLI (`copilot`) was not found. Install it (https://docs.github.com/en/copilot/how-tos/copilot-cli) and sign in, then try again.';

/** Whether the GitHub Copilot CLI can be started. */
export const isCopilotAvailable = (): boolean =>
  spawnSync('copilot', ['--version'], { shell: true, stdio: 'ignore' }).status === 0;

/**
 * The prompt for Copilot: fix only the problems of one rule, without shortcuts. The text is in
 * `copilot-fix-prompt.json`; `{ruleId}` and `{messageFile}` are interpolated. The problems
 * themselves come from the `check` command.
 */
export const copilotFixPrompt = (ruleId: string, messageFile: string): string =>
  promptTemplate.lines
    .join(' ')
    .replaceAll('{ruleId}', ruleId)
    .replaceAll('{messageFile}', messageFile);

/**
 * The `--allow-tool` value that lets Copilot write the message file and the files with problems
 * without asking; other files still need permission. When the list is too long for a command
 * line, only the message file is allowed.
 */
export const allowWriteTools = (messageFile: string, files: string[]): string => {
  const rules = [messageFile, ...files.filter((file) => SAFE_PATH.test(file))].map(
    (file) => `write(${file})`,
  );
  const all = rules.join(',');
  return all.length <= MAX_ALLOW_LENGTH ? all : `write(${messageFile})`;
};

/** The first line of the message file; the file is removed. */
const readMessage = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line !== '');
  } catch {
    return undefined;
  } finally {
    rmSync(file, { force: true });
  }
};

/** The outcome of a Copilot run: whether it ran fine, and the commit message it wrote, if any. */
export type CopilotResult = { ok: boolean; message?: string };

/**
 * Starts the Copilot CLI interactively with a prompt to fix the problems of the rule in `files`,
 * and waits until it exits (the user types /exit). Copilot writes a commit message to a file,
 * which is returned. Logs why and returns `ok: false` when Copilot is unavailable or fails.
 */
export const runCopilotFix = (
  projectDir: string,
  ruleId: string,
  files: string[],
): CopilotResult => {
  if (!SAFE_RULE_ID.test(ruleId)) {
    clack.log.error(`Can't pass the rule name ${ruleId} to Copilot.`);
    return { ok: false };
  }
  if (!isCopilotAvailable()) {
    clack.log.error(COPILOT_MISSING_MESSAGE);
    return { ok: false };
  }
  mkdirSync(path.join(projectDir, MESSAGE_DIR), { recursive: true });
  const messageFile = `${MESSAGE_DIR}/commit-${randomUUID()}.txt`;
  const args = [
    '-i',
    `"${copilotFixPrompt(ruleId, messageFile)}"`,
    `--allow-tool="${allowWriteTools(messageFile, files)},${ALLOW_CHECK}"`,
  ];
  const result = spawnSync('copilot', args, { cwd: projectDir, stdio: 'inherit', shell: true });
  const message = readMessage(path.join(projectDir, messageFile));
  if (result.status !== 0) {
    clack.log.error('Copilot did not finish successfully.');
    return { ok: false, message };
  }
  clack.log.success('Copilot finished.');
  return { ok: true, message };
};
