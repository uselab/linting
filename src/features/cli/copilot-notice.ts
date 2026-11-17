import * as clack from '@clack/prompts';
import { sanitizeInstructions } from './copilot-fix';

export const COPILOT_START_NOTE =
  'GitHub Copilot will be started to fix the problems of this rule. When it is done you return to this CLI.\nTo leave Copilot when it is done, type /exit.';

type Answer = 'ok' | 'extra' | 'no';

/** The user agreed to start Copilot, optionally with extra instructions. */
export type CopilotStart = { instructions?: string };

/** Asks for extra instructions; undefined when left empty or cancelled. */
const askInstructions = async (): Promise<string | undefined> => {
  const answer = await clack.text({
    message: 'Extra instructions for Copilot (empty to start without)',
    placeholder: 'e.g. keep the public API unchanged',
  });
  if (clack.isCancel(answer)) {
    return undefined;
  }
  const clean = sanitizeInstructions(answer);
  if (clean !== answer.trim()) {
    clack.log.warn(
      'Double quotes were replaced by single quotes, and line breaks and shell characters (` $ % ^ & | < > \\) were removed, as the text is passed through a shell.',
    );
  }
  return clean === '' ? undefined : clean;
};

/**
 * Explains how Copilot is started and left, before it starts. Returns how to start Copilot, or
 * undefined when the user goes back.
 */
export const confirmCopilotStart = async (): Promise<CopilotStart | undefined> => {
  clack.note(COPILOT_START_NOTE, 'Fix with Copilot');
  const answer = await clack.select<Answer>({
    message: 'Start Copilot?',
    options: [
      { value: 'ok', label: 'Yes' },
      { value: 'extra', label: 'Start Copilot with extra instructions' },
      { value: 'no', label: "Go back, don't start Copilot" },
    ],
  });
  if (clack.isCancel(answer) || answer === 'no') {
    return undefined;
  }
  return answer === 'extra' ? { instructions: await askInstructions() } : {};
};
