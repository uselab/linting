import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { isCancel } from '@clack/core';
import { describe, expect, it } from 'vitest';
import {
  cycleAction,
  IGNORE_INTRODUCTION,
  moveRuleActions,
  promptRuleActions,
  renderRuleActions,
} from '../../src/features/cli/rule-actions-prompt';

const choices = [
  { ruleId: 'rule-a', hint: '2 errors in 1 file' },
  { ruleId: 'rule-b', hint: '1 warning in 1 file' },
];

describe('cycleAction', () => {
  it('cycles keep → disable → ignore', () => {
    expect(cycleAction('keep', 1)).toBe('disable');
    expect(cycleAction('disable', 1)).toBe('ignore');
    expect(cycleAction('ignore', 1)).toBe('keep');
    expect(cycleAction('keep', -1)).toBe('ignore');
  });
});

describe('moveRuleActions', () => {
  const initial = { cursor: 0, actions: ['keep', 'keep'] } as const;

  it('moves the cursor around', () => {
    expect(moveRuleActions({ ...initial, actions: [...initial.actions] }, 'up').cursor).toBe(1);
    expect(moveRuleActions({ ...initial, actions: [...initial.actions] }, 'down').cursor).toBe(1);
  });

  it('changes the action of the rule under the cursor', () => {
    const state = { cursor: 1, actions: [...initial.actions] };
    expect(moveRuleActions(state, 'space').actions).toEqual(['keep', 'disable']);
    expect(moveRuleActions(state, 'right').actions).toEqual(['keep', 'disable']);
    expect(moveRuleActions(state, 'left').actions).toEqual(['keep', 'ignore']);
  });
});

describe('renderRuleActions', () => {
  const output = new PassThrough();

  it('shows a row per rule with its action', () => {
    const text = stripVTControlCharacters(
      renderRuleActions({
        message: 'What?',
        choices,
        state: { cursor: 1, actions: ['ignore', 'keep'] },
        promptState: 'active',
        output,
      }),
    );
    expect(text).toContain('  ignore with comments  rule-a (2 errors in 1 file)');
    expect(text).toContain('❯ keep                  rule-b (1 warning in 1 file)');
    expect(text.indexOf(IGNORE_INTRODUCTION)).toBeLessThan(text.indexOf('rule-a'));
  });

  it('summarizes the chosen actions', () => {
    const text = stripVTControlCharacters(
      renderRuleActions({
        message: 'What?',
        choices,
        state: { cursor: 1, actions: ['ignore', 'disable'] },
        promptState: 'submit',
        output,
      }),
    );
    expect(text).toContain('rule-a: ignore with comments, rule-b: disable');
  });

  it('shows no changes after esc', () => {
    const text = stripVTControlCharacters(
      renderRuleActions({
        message: 'What?',
        choices,
        state: { cursor: 0, actions: ['keep', 'keep'] },
        promptState: 'cancel',
        output,
        escaped: true,
      }),
    );
    expect(text).toContain('no changes');
  });
});

describe('promptRuleActions', () => {
  const start = () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    return { input, result: promptRuleActions({ message: 'What?', choices, input, output }) };
  };

  it('returns the actions chosen with the keyboard', async () => {
    const { input, result } = start();
    for (const key of ['\u001B[C', '\u001B[B', ' ', ' ', '\r']) {
      input.write(key);
    }
    expect(await result).toEqual(['disable', 'ignore']);
  });

  it('continues without changes on esc', async () => {
    const { input, result } = start();
    input.write(' ');
    input.emit('keypress', undefined, { name: 'escape', sequence: '\u001B' });
    expect(await result).toEqual(['keep', 'keep']);
  });

  it('cancels on ctrl+c', async () => {
    const { input, result } = start();
    input.write('\u0003');
    expect(isCancel(await result)).toBe(true);
  });
});
