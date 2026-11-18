import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import promptTemplate from './copilot-fix-prompt.json';
import ruleInstructions from './copilot-rule-instructions.json';

const SAFE_RULE_ID = /^[\w@/.-]+$/u;
/** Paths that can be put in the quoted `--allow-tool` value without escaping. */
const SAFE_PATH = /^[\w@/.+-]+$/u;
const MESSAGE_DIR = 'node_modules/.cache/uselab-linting';
const MAX_ALLOW_LENGTH = 6000;
/**
 * Pre-approves the check command (any rule) so Copilot can verify its work without asking.
 * Copilot names the command `npx uselab-linting`, so a longer prefix never matches. It checks
 * every part of a chained command separately, so the usual helpers (`cd`, filtering the output)
 * are allowed as well.
 */
const ALLOW_CHECK = [
  'shell(npx uselab-linting:*)',
  'shell(cd)',
  'shell(Select-Object)',
  'shell(Select-String)',
].join(',');

export const COPILOT_MISSING_MESSAGE =
  'GitHub Copilot CLI (`copilot`) was not found. Install it (https://docs.github.com/en/copilot/how-tos/copilot-cli) and sign in, then try again.';

/** Whether the GitHub Copilot CLI can be started. */
export const isCopilotAvailable = (): boolean =>
  spawnSync('copilot', ['--version'], { shell: true, stdio: 'ignore' }).status === 0;

const INSTRUCTIONS_PLACEHOLDER = '{ruleInstructions}';

/** The rule-specific instructions from `copilot-rule-instructions.json`, if the rule has any. */
const instructionsFor = (ruleId: string): string | undefined => {
  const rules: Record<string, string[]> = ruleInstructions.rules;
  const lines = Object.hasOwn(rules, ruleId) ? rules[ruleId] : undefined;
  return lines && lines.length > 0
    ? `Specific guidance for this rule: ${lines.join(' ')}`
    : undefined;
};

/**
 * Makes user text safe to put in the prompt, which is passed through a shell inside double quotes:
 * double quotes become single quotes, newlines become spaces and shell characters are removed.
 */
export const sanitizeInstructions = (text: string): string =>
  text
    .replaceAll('"', "'")
    .replaceAll(/\s*[\r\n]+\s*/gu, ' ')
    .replaceAll(/[`$%^&|<>\\]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();

/**
 * The prompt for Copilot: fix only the problems of one rule, without shortcuts. The text is in
 * `copilot-fix-prompt.json`; `{ruleId}` and `{messageFile}` are interpolated, and
 * `{ruleInstructions}` is replaced by the rule's entry in `copilot-rule-instructions.json`
 * (the line is dropped without one). The problems themselves come from the `check` command.
 * `userInstructions` (already sanitized) are added at the end.
 */
export const copilotFixPrompt = (
  ruleId: string,
  messageFile: string,
  userInstructions?: string,
): string => {
  const extra = instructionsFor(ruleId);
  const prompt = promptTemplate.lines
    .filter((line) => extra !== undefined || line !== INSTRUCTIONS_PLACEHOLDER)
    .map((line) => (line === INSTRUCTIONS_PLACEHOLDER ? (extra ?? '') : line))
    .join(' ')
    .replaceAll('{ruleId}', ruleId)
    .replaceAll('{messageFile}', messageFile);
  return userInstructions
    ? `${prompt} Extra instructions from the user: ${userInstructions}`
    : prompt;
};

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
  { files, instructions }: { files: string[]; instructions?: string },
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
  const prompt = copilotFixPrompt(
    ruleId,
    messageFile,
    instructions && sanitizeInstructions(instructions),
  );
  const args = [
    '-i',
    `"${prompt}"`,
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
