import * as clack from '@clack/prompts';

export const COPILOT_START_NOTE =
  'GitHub Copilot will be started to fix the problems of this rule. When it is done you return to this CLI.\nTo leave Copilot when it is done, type /exit.';

type Answer = 'ok' | 'no';

/** Explains how Copilot is started and left, before it starts. Returns whether to start Copilot. */
export const confirmCopilotStart = async (): Promise<boolean> => {
  clack.note(COPILOT_START_NOTE, 'Fix with Copilot');
  const answer = await clack.select<Answer>({
    message: 'Start Copilot?',
    options: [
      { value: 'ok', label: 'Ok' },
      { value: 'no', label: 'No' },
    ],
  });
  return !clack.isCancel(answer) && answer === 'ok';
};
