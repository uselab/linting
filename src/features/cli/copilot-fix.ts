import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import type { Problem } from './analyze';
import copilotFix from './copilot-fix.json';

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

const INSTRUCTIONS_SEPARATOR = '\n';

/** The Copilot mode to start in. */
export type CopilotMode = 'interactive' | 'plan' | 'autopilot';

const MODES: readonly CopilotMode[] = ['interactive', 'plan', 'autopilot'];

const SAFE_MODEL = /^[\w.:-]+$/u;

/** Whether a model name can safely be passed to `copilot --model` through a shell. */
export const isValidModel = (model: string): boolean => SAFE_MODEL.test(model);

/**
 * The model names from the output of `copilot help config`: the quoted list that follows the
 * description of the `model` setting.
 */
export const parseModels = (helpText: string): string[] => {
  const lines = helpText.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim().startsWith('`model`:'));
  if (start === -1) {
    return [];
  }
  const models: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const name = /^\s*-\s+"([^"]+)"\s*$/u.exec(line)?.[1];
    if (name !== undefined && isValidModel(name)) {
      models.push(name);
    } else if (models.length > 0) {
      break;
    }
  }
  return models;
};

/** The models the installed Copilot CLI knows of; empty when they can't be determined. */
export const listCopilotModels = (): string[] => {
  const result = spawnSync('copilot', ['help', 'config'], {
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? parseModels(result.stdout) : [];
};

type RuleSettings = { instructions?: string[]; defaultMode?: string };

const ruleSettings = (ruleId: string): RuleSettings | undefined => {
  const rules: Record<string, RuleSettings> = copilotFix.rules;
  return Object.hasOwn(rules, ruleId) ? rules[ruleId] : undefined;
};

/** The preselected Copilot mode of a rule from `copilot-fix.json`; interactive when not set. */
export const defaultMode = (ruleId: string): CopilotMode =>
  MODES.find((candidate) => candidate === ruleSettings(ruleId)?.defaultMode) ?? 'interactive';

/** The models offered first in the model question, from `copilot-fix.json`. */
export const defaultModels = (): string[] => copilotFix.defaultModels.filter(isValidModel);

const USED_MODELS_FILE = path.join(MESSAGE_DIR, 'used-models.json');
const MAX_USED_MODELS = 10;

/** The models used before in this project, most recent first; empty when unknown. */
export const usedModels = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(USED_MODELS_FILE, 'utf8'));
    return Array.isArray(parsed)
      ? parsed.filter((model): model is string => typeof model === 'string' && isValidModel(model))
      : [];
  } catch {
    return [];
  }
};

/** Remembers a used model (most recent first); failures to write are ignored. */
export const saveUsedModel = (model: string): void => {
  if (!isValidModel(model)) {
    return;
  }
  const models = [model, ...usedModels().filter((used) => used !== model)].slice(
    0,
    MAX_USED_MODELS,
  );
  try {
    mkdirSync(MESSAGE_DIR, { recursive: true });
    writeFileSync(USED_MODELS_FILE, JSON.stringify(models, undefined, 2));
  } catch {
    // Remembering models is optional.
  }
};

/** The default models followed by the previously used models that are not among them. */
export const modelChoices = (): string[] => {
  const defaults = defaultModels();
  return [...defaults, ...usedModels().filter((model) => !defaults.includes(model))];
};

/** The rule-specific instructions from `copilot-fix.json` as lines, if the rule has any. */
const instructionsFor = (ruleId: string): string[] => {
  const lines = ruleSettings(ruleId)?.instructions;
  return lines && lines.length > 0 ? ['Specific guidance for this rule:', ...lines] : [];
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
 * The default instructions of a rule, with `{ruleId}` filled in. One line per sentence, followed
 * by the rule-specific instructions, a heading and then one line per entry.
 */
export const defaultInstructions = (ruleId: string): string =>
  [...copilotFix.prompt, ...instructionsFor(ruleId)]
    .map((line) => line.replaceAll('{ruleId}', ruleId))
    .join(INSTRUCTIONS_SEPARATOR);

/**
 * The instructions that always come first and cannot be edited: where Copilot writes the commit
 * message and that the user leaves with /exit. `messageFile` is the file name to show.
 */
export const fixedInstructions = (
  ruleId: string,
  messageFile: string,
  problemsFile = 'a temporary file',
): string =>
  copilotFix.fixedInstructions
    .join(' ')
    .replaceAll('{ruleId}', ruleId)
    .replaceAll('{messageFile}', messageFile)
    .replaceAll('{problemsFile}', problemsFile);

/** The problems of a rule as text, one per line like the `check` command prints them. */
export const problemsText = (ruleId: string, problems: Problem[]): string =>
  [
    `ESLint problems of ${ruleId}:`,
    ...problems.map(
      ({ file, line, column, message, severity }) =>
        `${file}:${line}:${column}  ${severity === 2 ? 'error' : 'warning'}  ${message}`,
    ),
    '',
  ].join('\n');

/**
 * The prompt for Copilot: the fixed instructions followed by the (edited) instructions, which
 * are the defaults when not given. The text is in `copilot-fix.json`. The problems themselves
 * are in `problemsFile`.
 */
export const copilotFixPrompt = (
  ruleId: string,
  messageFile: string,
  {
    instructions = defaultInstructions(ruleId),
    problemsFile,
  }: { instructions?: string; problemsFile?: string } = {},
): string =>
  `${fixedInstructions(ruleId, messageFile, problemsFile)} ${sanitizeInstructions(instructions)}`;

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
  {
    files,
    instructions,
    mode = 'interactive',
    model,
    problems = [],
  }: {
    files: string[];
    instructions?: string;
    mode?: CopilotMode;
    model?: string;
    problems?: Problem[];
  },
): CopilotResult => {
  if (!SAFE_RULE_ID.test(ruleId)) {
    clack.log.error(`Can't pass the rule name ${ruleId} to Copilot.`);
    return { ok: false };
  }
  if (model !== undefined && !isValidModel(model)) {
    clack.log.error(`Can't pass the model name ${model} to Copilot.`);
    return { ok: false };
  }
  if (!isCopilotAvailable()) {
    clack.log.error(COPILOT_MISSING_MESSAGE);
    return { ok: false };
  }
  mkdirSync(path.join(projectDir, MESSAGE_DIR), { recursive: true });
  const messageFile = `${MESSAGE_DIR}/commit-${randomUUID()}.txt`;
  const problemsFile = `${MESSAGE_DIR}/problems-${randomUUID()}.txt`;
  writeFileSync(path.join(projectDir, problemsFile), problemsText(ruleId, problems));
  const prompt = copilotFixPrompt(ruleId, messageFile, { instructions, problemsFile });
  const args = [
    '-i',
    `"${prompt}"`,
    `--allow-tool="${allowWriteTools(messageFile, files)},${ALLOW_CHECK}"`,
    ...(mode === 'interactive' ? [] : ['--mode', mode]),
    ...(model === undefined ? [] : ['--model', model]),
  ];
  const result = spawnSync('copilot', args, { cwd: projectDir, stdio: 'inherit', shell: true });
  const message = readMessage(path.join(projectDir, messageFile));
  rmSync(path.join(projectDir, problemsFile), { force: true });
  if (result.status !== 0) {
    clack.log.error('Copilot did not finish successfully.');
    return { ok: false, message };
  }
  clack.log.success('Copilot finished.');
  return { ok: true, message };
};
