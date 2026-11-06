import * as clack from '@clack/prompts';
import type { Problem } from './analyze';
import { writeDisabledRules } from './disable-rules';
import { ignoreProblems } from './ignore-comments';
import { askRuleActions, type RuleChoice } from './rule-actions-prompt';

const rulesWith = (actions: Map<string, string>, wanted: string): string[] =>
  [...actions].flatMap(([ruleId, action]) => (action === wanted ? [ruleId] : []));

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

/**
 * Asks per rule whether to keep it, disable it in the ESLint config, or ignore its problems with
 * `eslint-disable-next-line` comments, and applies the choices. Returns whether anything changed.
 */
export const applyRuleActions = async (
  projectDir: string,
  choices: RuleChoice[],
  problems: Problem[],
): Promise<boolean> => {
  if (choices.length === 0) {
    return false;
  }
  const actions = await askRuleActions(choices);
  const disable = rulesWith(actions, 'disable');
  const ignore = rulesWith(actions, 'ignore');
  const disabled = disable.length > 0 && (await writeDisabledRules(projectDir, disable));
  const ignored = ignore.length > 0 && ignoreRules(projectDir, ignore, problems);
  return disabled || ignored;
};
