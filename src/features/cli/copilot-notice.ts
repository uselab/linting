import * as clack from '@clack/prompts';
import * as ask from './ask';
import {
  defaultInstructions,
  defaultMode,
  defaultModels,
  fixedInstructions,
  isValidModel,
  listCopilotModels,
  modelChoices,
  sanitizeInstructions,
  saveUsedModel,
  usedModels,
  type CopilotMode,
} from './copilot-fix';
import { multiline } from './multiline';

export type { CopilotMode };

const copilotStartNote = (goal: string): string =>
  `GitHub Copilot will be started to ${goal}. When it is done you return to this CLI.\nTo leave Copilot when it is done, type /exit.`;

export const COPILOT_START_NOTE = copilotStartNote('fix the problems of this rule');

/** The user agreed to start Copilot with these (possibly edited) instructions. */
export type CopilotStart = { instructions: string; mode: CopilotMode; model?: string };

const OTHER_MODEL = 'other';
const CUSTOM_MODEL = 'custom';

const MODEL_HINT = 'Run /model in Copilot to see the models you can use.';

/** Asks for a model from all models Copilot lists, or a typed name; undefined goes back. */
const askAnyModel = async (): Promise<string | undefined> => {
  const choice = await ask.select<string>({
    message: 'All Copilot models (Esc to go back)',
    options: [
      ...listCopilotModels().map((model) => ({ value: model, label: model })),
      { value: CUSTOM_MODEL, label: 'Enter a model name', hint: MODEL_HINT },
    ],
  });
  if (typeof choice === 'symbol') {
    return undefined;
  }
  if (choice !== CUSTOM_MODEL) {
    return choice;
  }
  const name = await ask.text({
    message: 'Model name (Esc to go back)',
    placeholder: 'e.g. gpt-5.6-sol',
    validate: (value) =>
      value && isValidModel(value.trim()) ? undefined : 'Enter a valid model name',
  });
  return typeof name === 'symbol' ? undefined : name.trim();
};

/**
 * Asks for the model: one of the `defaultModels` of `copilot.config.json` or the models used before
 * (the last used one is preselected), or another model from the full list. Returns undefined when
 * the user goes back.
 */
const askModel = async (): Promise<{ model: string } | undefined> => {
  for (;;) {
    const choice = await ask.select<string>({
      message: 'Copilot model (Esc to go back)',
      initialValue: usedModels()[0] ?? defaultModels()[0],
      options: [
        ...modelChoices().map((model) => ({ value: model, label: model })),
        { value: OTHER_MODEL, label: 'Other model', hint: 'choose from all models' },
      ],
    });
    if (typeof choice === 'symbol') {
      return undefined;
    }
    if (choice !== OTHER_MODEL) {
      saveUsedModel(choice);
      return { model: choice };
    }
    const model = await askAnyModel();
    if (model !== undefined) {
      saveUsedModel(model);
      return { model };
    }
  }
};

/** Sanitizes the instructions for the shell, warning when that changed more than the line breaks. */
const cleanInstructions = (text: string): string => {
  const clean = sanitizeInstructions(text);
  if (clean !== text.replaceAll(/\s+/gu, ' ').trim()) {
    clack.log.warn(
      'Double quotes were replaced by single quotes, and shell characters (` $ % ^ & | < > \\) were removed, as the text is passed through a shell.',
    );
  }
  return clean;
};

/**
 * Explains how Copilot is started and left, then lets the user edit the instructions for the rule
 * (or task, with its own `goal` and `title`) and choose the Copilot mode. The fixed instructions
 * are shown but cannot be edited. Returns how to start Copilot, or undefined when the user
 * cancels to go back.
 */
export const confirmCopilotStart = async (
  ruleId: string,
  { goal, title = 'Fix with Copilot' }: { goal?: string; title?: string } = {},
): Promise<CopilotStart | undefined> => {
  const note = goal === undefined ? COPILOT_START_NOTE : copilotStartNote(goal);
  clack.note(
    `${note}\n\nAlways added in front of your instructions:\n${fixedInstructions(ruleId, 'a temporary file')}`,
    title,
  );
  const instructions = await multiline({
    message: 'Instructions for Copilot',
    initialValue: defaultInstructions(ruleId),
    back: true,
    validate: (value) => (value?.trim() ? undefined : 'The instructions cannot be empty'),
  });
  if (clack.isCancel(instructions)) {
    return undefined;
  }
  const mode = await ask.select<CopilotMode>({
    message: 'Copilot mode (Esc to go back)',
    initialValue: defaultMode(ruleId),
    options: [
      {
        value: 'interactive',
        label: 'Interactive',
        hint: 'Copilot asks for permission and input as it works',
      },
      {
        value: 'plan',
        label: 'Plan',
        hint: 'Copilot makes a plan first, which you approve before it changes files',
      },
      {
        value: 'autopilot',
        label: 'Autopilot',
        hint: 'Copilot works on its own until the task is done',
      },
    ],
  });
  if (typeof mode === 'symbol') {
    return undefined;
  }
  const chosen = await askModel();
  if (chosen === undefined) {
    return undefined;
  }
  return { instructions: cleanInstructions(instructions), mode, ...chosen };
};
