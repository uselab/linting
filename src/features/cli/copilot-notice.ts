import * as clack from '@clack/prompts';

export const COPILOT_START_NOTE =
  'GitHub Copilot will be started to fix the problems of this rule. When it is done you return to this CLI.\nTo leave Copilot when it is done, type /exit.';

type Answer = 'ok' | 'always' | 'no';

let dontAskAgain = false;

/** Forgets "Ok, don't ask me again". */
export const resetCopilotNotice = (): void => {
  dontAskAgain = false;
};

/**
 * Explains how Copilot is started and left, before it starts. Returns whether to start Copilot;
 * "Ok, don't ask me again" skips this notice for the rest of the run.
 */
export const confirmCopilotStart = async (): Promise<boolean> => {
  if (dontAskAgain) {
    return true;
  }
  clack.note(COPILOT_START_NOTE, 'Fix with Copilot');
  const answer = await clack.select<Answer>({
    message: 'Start Copilot?',
    options: [
      { value: 'ok', label: 'Ok' },
      { value: 'always', label: "Ok, don't ask me again" },
      { value: 'no', label: 'No' },
    ],
  });
  if (clack.isCancel(answer) || answer === 'no') {
    return false;
  }
  dontAskAgain = answer === 'always';
  return true;
};
