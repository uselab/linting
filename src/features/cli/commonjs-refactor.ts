import * as clack from '@clack/prompts';
import * as ask from './ask';
import type { CommitOffer } from './commit-offer';
import { TOOLING_FILES } from './cleanup';
import {
  findCommonJsUsages,
  remainingUsagesMessage,
  usagesText,
  type CommonJsUsage,
} from './commonjs';
import { COPILOT_MISSING_MESSAGE, isCopilotAvailable, runCopilotFix } from './copilot-fix';
import { confirmCopilotStart, type CopilotStart } from './copilot-notice';
import { unwrap } from './prompts';

/** The id of the refactor in `copilot.config.json` (under `tasks`). */
const COMMONJS_TASK = 'commonjs';

const DEFAULT_MESSAGE = 'Set "type": "module" and converted CommonJS to ES modules with Copilot';

type Choice = 'copilot' | 'keep';

type RefactorOptions = {
  usages: readonly CommonJsUsage[];
  start: CopilotStart;
  commits: CommitOffer;
  setType: () => void;
};

/** Starts the Copilot questions; undefined when Copilot is missing or the user goes back. */
const askCopilotStart = async (): Promise<CopilotStart | undefined> => {
  if (!isCopilotAvailable()) {
    clack.log.error(COPILOT_MISSING_MESSAGE);
    return undefined;
  }
  return confirmCopilotStart(COMMONJS_TASK, {
    goal: 'convert the CommonJS code to ES modules',
    title: 'Refactor with Copilot',
  });
};

/**
 * Asks whether to set `"type": "module"` and let Copilot convert the listed CommonJS code, or keep
 * the type unchanged. Returns how to start Copilot, or undefined to keep the type. Going back in
 * the Copilot questions, or a missing Copilot, asks again.
 */
export const askCommonJsRefactor = async (): Promise<CopilotStart | undefined> => {
  for (;;) {
    const choice = unwrap(
      await ask.select<Choice>({
        message: 'Set "type": "module" in package.json?',
        options: [
          {
            value: 'copilot',
            label: 'Refactor with Copilot',
            hint: 'sets the type and starts Copilot to convert the CommonJS code',
          },
          { value: 'keep', label: 'Keep type unchanged', hint: 'the config becomes .mts' },
        ],
        initialValue: 'copilot',
      }),
    );
    if (choice === 'keep') {
      return undefined;
    }
    const start = await askCopilotStart();
    if (start) {
      return start;
    }
  }
};

/**
 * Sets the module type with `setType` and lets Copilot convert the CommonJS code, as one step with
 * its own commit offer (Copilot's commit message is the default). Warns about CommonJS that is
 * left afterwards.
 */
export const refactorCommonJs = async (
  projectDir: string,
  { usages, start, commits, setType }: RefactorOptions,
): Promise<void> => {
  let message: string | undefined;
  await commits.step(
    () => message ?? DEFAULT_MESSAGE,
    () => {
      setType();
      message = runCopilotFix(projectDir, COMMONJS_TASK, {
        ...start,
        files: [...new Set(usages.map(({ file }) => file))],
        details: usagesText(usages),
      }).message;
    },
  );
  const remaining = findCommonJsUsages(projectDir, TOOLING_FILES);
  if (remaining.length > 0) {
    clack.log.warn(remainingUsagesMessage(remaining));
  }
};
