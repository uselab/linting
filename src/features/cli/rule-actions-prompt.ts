import * as clack from '@clack/prompts';

/** What to do with the problems of a rule. */
export type RuleAction = 'disable' | 'ignore' | 'editIgnores' | 'skip' | 'finish';

/** A rule that can be disabled or ignored, with a hint such as its problem counts. */
export type RuleChoice = { ruleId: string; hint: string };

export const IGNORE_INTRODUCTION =
  'Ignore with comments leaves the existing code unchanged and keeps the rule active for new code.';

export const EDIT_IGNORES_LABEL = 'Edit ESLint ignore configuration';

export const EDIT_IGNORES_EXPLANATION =
  "Files linted that shouldn't be, or missed that should be? Edit that here.";

const options = (ruleId: string): { value: RuleAction; label: string; hint: string }[] => [
  { value: 'skip', label: 'Skip this rule', hint: 'I will fix this myself' },
  {
    value: 'ignore',
    label: 'Ignore with comments',
    hint: 'eslint-disable-next-line above each problem; the rule stays active for new code',
  },
  { value: 'disable', label: `Disable ${ruleId}`, hint: 'turn it off in the ESLint config' },
  { value: 'editIgnores', label: EDIT_IGNORES_LABEL, hint: EDIT_IGNORES_EXPLANATION },
];

/** Asks what to do with a single rule; esc finishes, to continue to the report. */
export const askRuleAction = async ({ ruleId, hint }: RuleChoice): Promise<RuleAction> => {
  const action = await clack.select<RuleAction>({
    message: `${ruleId} (${hint}): what to do?`,
    options: options(ruleId),
    initialValue: 'skip',
  });
  return clack.isCancel(action) ? 'finish' : action;
};
