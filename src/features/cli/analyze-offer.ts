import * as clack from '@clack/prompts';
import { runAnalyze } from './analyze';
import type { CommitOffer } from './commit-offer';
import type { Requirement } from './dependencies';
import { missingInstalls, runInstall } from './install';
import { confirm } from './prompts';

/**
 * Offers to run the lint analysis at the end of init, first offering to install the dependencies
 * when init changed them (`install`) or they aren't installed. Returns whether the analysis ran
 * (it ends with its own outro).
 */
export const offerAnalyze = async (
  projectDir: string,
  requirements: Requirement[],
  { install, commits }: { install: string | undefined; commits?: CommitOffer },
): Promise<boolean> => {
  if (!(await confirm('Run the lint analysis (uselab-linting analyze) now?'))) {
    return false;
  }
  const command =
    install ?? (missingInstalls(projectDir, requirements).length > 0 ? 'npm install' : undefined);
  if (command !== undefined) {
    if (!(await confirm(`The analysis needs the dependencies installed. Run ${command} first?`))) {
      clack.log.info('Skipped the lint analysis.');
      return false;
    }
    if (!runInstall(projectDir, command)) {
      clack.log.error(`${command} failed; skipped the lint analysis.`);
      return false;
    }
    clack.log.success(`Ran ${command}.`);
  }
  await runAnalyze(projectDir, true, { intro: false, commits });
  return true;
};
