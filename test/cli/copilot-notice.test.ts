import { beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): { answers: (string | symbol)[]; selects: number; notes: string[] } => ({
    answers: [],
    selects: 0,
    notes: [],
  }),
);

vi.mock('@clack/prompts', () => ({
  note: (message: string) => prompts.notes.push(message),
  isCancel: (value: unknown) => typeof value === 'symbol',
  select: async () => {
    prompts.selects += 1;
    return prompts.answers.shift();
  },
}));

const { confirmCopilotStart } = await import('../../src/features/cli/copilot-notice');

describe('confirmCopilotStart', () => {
  beforeEach(() => {
    prompts.answers = [];
    prompts.selects = 0;
    prompts.notes = [];
  });

  it('explains how to exit and starts on Ok, asking again next time', async () => {
    prompts.answers = ['ok', 'ok'];
    expect(await confirmCopilotStart()).toBe(true);
    expect(await confirmCopilotStart()).toBe(true);
    expect(prompts.selects).toBe(2);
    expect(prompts.notes[0]).toContain('/exit');
    expect(prompts.notes[0]).toContain('return to this CLI');
  });

  it('does not start on No or cancel', async () => {
    prompts.answers = ['no', Symbol('cancel')];
    expect(await confirmCopilotStart()).toBe(false);
    expect(await confirmCopilotStart()).toBe(false);
  });
});
