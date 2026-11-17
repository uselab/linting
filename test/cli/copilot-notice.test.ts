import { beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): {
    answers: (string | symbol)[];
    texts: (string | symbol)[];
    warnings: string[];
    selects: number;
    notes: string[];
  } => ({
    answers: [],
    texts: [],
    warnings: [],
    selects: 0,
    notes: [],
  }),
);

vi.mock('@clack/prompts', () => ({
  note: (message: string) => prompts.notes.push(message),
  isCancel: (value: unknown) => typeof value === 'symbol',
  log: { warn: (message: string) => prompts.warnings.push(message) },
  text: async () => prompts.texts.shift(),
  select: async () => {
    prompts.selects += 1;
    return prompts.answers.shift();
  },
}));

const { confirmCopilotStart } = await import('../../src/features/cli/copilot-notice');

describe('confirmCopilotStart', () => {
  beforeEach(() => {
    prompts.answers = [];
    prompts.texts = [];
    prompts.warnings = [];
    prompts.selects = 0;
    prompts.notes = [];
  });

  it('explains how to exit and starts on Ok, asking again next time', async () => {
    prompts.answers = ['ok', 'ok'];
    expect(await confirmCopilotStart()).toEqual({});
    expect(await confirmCopilotStart()).toEqual({});
    expect(prompts.selects).toBe(2);
    expect(prompts.notes[0]).toContain('/exit');
    expect(prompts.notes[0]).toContain('return to this CLI');
  });

  it('does not start on No or cancel', async () => {
    prompts.answers = ['no', Symbol('cancel')];
    expect(await confirmCopilotStart()).toBeUndefined();
    expect(await confirmCopilotStart()).toBeUndefined();
  });

  it('starts with the extra instructions', async () => {
    prompts.answers = ['extra'];
    prompts.texts = ['keep the API'];
    expect(await confirmCopilotStart()).toEqual({ instructions: 'keep the API' });
    expect(prompts.warnings).toEqual([]);
  });

  it('sanitizes the instructions and warns about it', async () => {
    prompts.answers = ['extra'];
    prompts.texts = ['say "hi" `now`'];
    expect(await confirmCopilotStart()).toEqual({ instructions: "say 'hi' now" });
    expect(prompts.warnings).toHaveLength(1);
  });

  it('starts without instructions when the text is empty or cancelled', async () => {
    prompts.answers = ['extra', 'extra'];
    prompts.texts = ['  ', Symbol('cancel')];
    expect(await confirmCopilotStart()).toEqual({ instructions: undefined });
    expect(await confirmCopilotStart()).toEqual({ instructions: undefined });
  });
});
