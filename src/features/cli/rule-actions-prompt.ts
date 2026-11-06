import { styleText } from 'node:util';
import { Prompt } from '@clack/core';
import { limitOptions, S_BAR, S_BAR_END, symbol } from '@clack/prompts';
import type { Readable, Writable } from 'node:stream';
import { unwrap } from './prompts';

/** What to do with the problems of a rule. */
export type RuleAction = 'keep' | 'disable' | 'ignore';

export const RULE_ACTIONS: readonly RuleAction[] = ['keep', 'disable', 'ignore'];

/** A rule that can be disabled or ignored, with a hint such as its problem counts. */
export type RuleChoice = { ruleId: string; hint: string };

const ACTION_LABELS: Record<RuleAction, string> = {
  keep: 'keep',
  disable: 'disable',
  ignore: 'ignore with comments',
};

const ACTION_WIDTH = Math.max(...RULE_ACTIONS.map((action) => ACTION_LABELS[action].length));

const ACTION_COLORS = {
  keep: 'dim',
  disable: 'red',
  ignore: 'yellow',
} as const satisfies Record<RuleAction, Parameters<typeof styleText>[0]>;

/** The action after (or, with step -1, before) the given one. */
export const cycleAction = (action: RuleAction, step: 1 | -1): RuleAction =>
  RULE_ACTIONS[(RULE_ACTIONS.indexOf(action) + step + RULE_ACTIONS.length) % RULE_ACTIONS.length] ??
  'keep';

export const IGNORE_INTRODUCTION =
  'Ignore with comments leaves the existing code unchanged and keeps the rule active for new code.';

const INSTRUCTIONS =
  '↑/↓ to move, ←/→ or space to change (keep → disable → ignore with comments), enter to confirm, esc to continue without changes';

/** The rule under the cursor and the action per rule. */
export type RuleActionsState = { cursor: number; actions: RuleAction[] };

/** Handles a cursor key: up/down moves, left/right/space changes the action. */
export const moveRuleActions = (
  state: RuleActionsState,
  key: string | undefined,
): RuleActionsState => {
  const count = state.actions.length;
  if (key === 'up' || key === 'down') {
    return { ...state, cursor: (state.cursor + (key === 'up' ? count - 1 : 1)) % count };
  }
  if (key === 'left' || key === 'right' || key === 'space') {
    const step = key === 'left' ? -1 : 1;
    return {
      ...state,
      actions: state.actions.map((action, index) =>
        index === state.cursor ? cycleAction(action, step) : action,
      ),
    };
  }
  return state;
};

const row = (choice: RuleChoice, action: RuleAction, active: boolean): string => {
  const label = styleText(ACTION_COLORS[action], ACTION_LABELS[action].padEnd(ACTION_WIDTH));
  const pointer = active ? styleText('cyan', '❯') : ' ';
  const rule = active ? choice.ruleId : styleText('dim', choice.ruleId);
  return `${pointer} ${label}  ${rule} ${styleText('dim', `(${choice.hint})`)}`;
};

const summary = (choices: RuleChoice[], actions: RuleAction[]): string => {
  const chosen = choices.flatMap(({ ruleId }, index) => {
    const action = actions[index] ?? 'keep';
    return action === 'keep' ? [] : [`${ruleId}: ${ACTION_LABELS[action]}`];
  });
  return styleText('dim', chosen.length > 0 ? chosen.join(', ') : 'none');
};

type RenderOptions = {
  message: string;
  choices: RuleChoice[];
  state: RuleActionsState;
  promptState: Prompt<RuleAction[]>['state'];
  output: Writable;
  /** Whether the prompt was left with esc (continue without changes). */
  escaped?: boolean;
};

const finalResult = ({ choices, state, promptState, escaped }: RenderOptions): string => {
  if (promptState === 'submit') {
    return summary(choices, state.actions);
  }
  return styleText('dim', escaped === true ? 'no changes' : 'cancelled');
};

/** Renders the prompt: the rows while active, the chosen actions once submitted. */
export const renderRuleActions = (options: RenderOptions): string => {
  const { message, choices, state, promptState, output } = options;
  const bar = styleText('gray', S_BAR);
  const header = `${bar}\n${symbol(options.escaped === true ? 'submit' : promptState)}  ${message}\n`;
  if (promptState === 'submit' || promptState === 'cancel') {
    return `${header}${bar}  ${finalResult(options)}`;
  }
  const side = styleText('cyan', S_BAR);
  const intro = `${side}  ${styleText('dim', IGNORE_INTRODUCTION)}\n${side}\n`;
  const rows = limitOptions({
    output,
    options: choices.map((choice, index) => ({ choice, index })),
    cursor: state.cursor,
    maxItems: 15,
    rowPadding: header.split('\n').length + intro.split('\n').length + 1,
    style: ({ choice, index }, active) => row(choice, state.actions[index] ?? 'keep', active),
  });
  const body = rows.map((line) => `${side}  ${line}`).join('\n');
  return `${header}${intro}${body}\n${side}  ${styleText('dim', INSTRUCTIONS)}\n${styleText('cyan', S_BAR_END)}\n`;
};

type RuleActionsOptions = {
  message: string;
  choices: RuleChoice[];
  input?: Readable;
  output?: Writable;
};

/**
 * Shows one row per rule; ←/→ or space cycles its action and enter submits the actions. Esc
 * continues without changes (every rule on keep); ctrl+c cancels.
 */
export const promptRuleActions = async ({
  message,
  choices,
  input,
  output = process.stdout,
}: RuleActionsOptions): Promise<RuleAction[] | symbol> => {
  let state: RuleActionsState = { cursor: 0, actions: choices.map((): RuleAction => 'keep') };
  let escaped = false;
  const prompt = new Prompt<RuleAction[]>(
    {
      input,
      output,
      render() {
        const promptState = this.state;
        return renderRuleActions({ message, choices, state, promptState, output, escaped });
      },
    },
    false,
  );
  prompt.value = state.actions;
  prompt.on('cursor', (key) => {
    state = moveRuleActions(state, key);
    prompt.value = state.actions;
  });
  prompt.on('key', (_char, info) => {
    escaped = info.name === 'escape';
  });
  const result = await prompt.prompt();
  return escaped ? choices.map((): RuleAction => 'keep') : (result ?? state.actions);
};

/** Asks what to do with each rule (default: keep; esc keeps all). */
export const askRuleActions = async (choices: RuleChoice[]): Promise<Map<string, RuleAction>> => {
  const actions = unwrap(
    await promptRuleActions({ message: 'What to do with the rules?', choices }),
  );
  return new Map(choices.map(({ ruleId }, index) => [ruleId, actions[index] ?? 'keep']));
};
