import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import type { Problem } from './analyze';
import { disabledCommitOffer, type CommitOffer } from './commit-offer';
import { runCopilotFix } from './copilot-fix';
import { confirmCopilotStart } from './copilot-notice';
import { findEslintConfigFile, writeDisabledRules } from './disable-rules';
import { readEslintConfig, updateEslintIgnores } from './eslint-config';
import { ignoreProblems } from './ignore-comments';
import { askScopeGlobs } from './prompts';
import { askRuleAction, type RuleAction, type RuleChoice } from './rule-actions-prompt';

const ignoreRules = (projectDir: string, ruleIds: string[], problems: Problem[]): boolean => {
  const { files, comments, skipped } = ignoreProblems(
    projectDir,
    problems.filter(({ ruleId }) => ruleIds.includes(ruleId)),
  );
  if (comments > 0) {
    const count = `${comments} comment${comments === 1 ? '' : 's'}`;
    clack.log.success(`Added ${count} to ${files.length} file${files.length === 1 ? '' : 's'}.`);
  }
  if (skipped.length > 0) {
    clack.log.warn(
      `Couldn't add comments for:\n${skipped.map(({ file, line, ruleId }) => `${file}:${line} ${ruleId}`).join('\n')}`,
    );
  }
  return comments > 0;
};

/** The ESLint config with a lint scope that can be rewritten, if any. */
const editableConfig = async (projectDir: string) => {
  const file = await findEslintConfigFile(projectDir);
  const text = file ? readFileSync(file, 'utf8') : undefined;
  const ignores = text === undefined ? undefined : readEslintConfig(text);
  return {
    name: file ? path.relative(projectDir, file) : 'the ESLint config',
    config:
      file && text !== undefined && ignores?.ignoresEditable
        ? { file, text, ignores: ignores.ignores ?? { mode: 'all' as const, globs: [] } }
        : undefined,
  };
};

/**
 * Asks for the globs of the lint scope in the `globalIgnores()` entry and rewrites it. Without a
 * `@uselab/linting` config with literal patterns, it only says where to change them by hand.
 * Returns whether the config was changed.
 */
export const editGlobalIgnores = async (projectDir: string): Promise<boolean> => {
  const { name, config } = await editableConfig(projectDir);
  if (!config) {
    clack.log.warn(
      `Can't edit the ignores in ${name} automatically; change the globalIgnores([...]) entry by hand.`,
    );
    return false;
  }
  const configFile = config.file;
  const configDir = path.dirname(configFile);
  const ignores = await askScopeGlobs(
    config.ignores,
    path.resolve(configDir) === path.resolve(projectDir) ? undefined : configDir,
  );
  const update = updateEslintIgnores(config.text, ignores);
  if (!update?.updated) {
    clack.log.info(`The ignores in ${name} are unchanged.`);
    return false;
  }
  writeFileSync(configFile, update.code);
  clack.log.success(`Updated the ignores in ${name}.`);
  return true;
};

/** The outcome of handling one rule: the project changed, the rule was skipped, or stop. */
export type RuleOutcome = 'changed' | 'skipped' | 'finished';

type ChangeAction = Exclude<RuleAction, 'skip' | 'finish'>;
type Step = [summary: string | (() => string), change: () => Promise<boolean> | boolean];

/** The files with problems of the rule. */
const ruleFiles = (ruleId: string, problems: Problem[]): string[] => [
  ...new Set(problems.filter((problem) => problem.ruleId === ruleId).map(({ file }) => file)),
];

/** Fixes the rule with Copilot; its commit message becomes the default commit message. */
const copilotStep = (projectDir: string, ruleId: string, problems: Problem[]): Step => {
  let message: string | undefined;
  return [
    () => message ?? `Fixed ${ruleId} with Copilot`,
    () => {
      const result = runCopilotFix(projectDir, ruleId, ruleFiles(ruleId, problems));
      message = result.message;
      return result.ok;
    },
  ];
};

/** The commit summary and the change of an action that may change the project. */
const stepFor = (
  action: ChangeAction,
  projectDir: string,
  { ruleId, problems }: { ruleId: string; problems: Problem[] },
): Step => {
  const steps: Record<ChangeAction, Step> = {
    copilot: copilotStep(projectDir, ruleId, problems),
    disable: [
      `Disabled ${ruleId} in the ESLint config`,
      () => writeDisabledRules(projectDir, [ruleId]),
    ],
    ignore: [
      `Added eslint-disable comments for ${ruleId}`,
      () => ignoreRules(projectDir, [ruleId], problems),
    ],
    editIgnores: [
      'Updated the lint scope in the ESLint config',
      () => editGlobalIgnores(projectDir),
    ],
  };
  return steps[action];
};

/** Whether to ask for an action again after an action that changed nothing. */
const asksAgain = (action: ChangeAction, declined: boolean): boolean =>
  declined || action === 'editIgnores';

/** Whether the action may start. Copilot needs a clean tree first and the user's consent. */
const mayStart = async (action: ChangeAction, commits: CommitOffer): Promise<boolean> => {
  if (action !== 'copilot') {
    return true;
  }
  await commits.ensureClean();
  return confirmCopilotStart();
};

/**
 * Asks what to do with a single rule: fix it with Copilot, disable it in the ESLint config, ignore
 * its problems with `eslint-disable-next-line` comments, edit the ignores, skip it or finish. When
 * editing the ignores changes nothing, or the Copilot notice is declined, it asks again.
 */
export const applyRuleAction = async (
  projectDir: string,
  choice: RuleChoice,
  { problems, commits = disabledCommitOffer }: { problems: Problem[]; commits?: CommitOffer },
): Promise<RuleOutcome> => {
  for (;;) {
    const action = await askRuleAction(choice);
    if (action === 'skip' || action === 'finish') {
      return action === 'skip' ? 'skipped' : 'finished';
    }
    const declined = !(await mayStart(action, commits));
    const changed =
      !declined &&
      (await commits.step(...stepFor(action, projectDir, { ruleId: choice.ruleId, problems })));
    if (changed) {
      return 'changed';
    }
    if (!asksAgain(action, declined)) {
      return 'skipped';
    }
  }
};
