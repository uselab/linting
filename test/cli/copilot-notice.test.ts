import { beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(
  (): {
    answers: (string | symbol)[];
    texts: (string | symbol)[];
    warnings: string[];
    selects: number;
    notes: string[];
    initialValues: string[];
    modeDefaults: string[];
    optionValues: string[][];
  } => ({
    answers: [],
    texts: [],
    warnings: [],
    selects: 0,
    notes: [],
    initialValues: [],
    modeDefaults: [],
    optionValues: [],
  }),
);

const files = vi.hoisted((): { content: string | undefined } => ({
  content: undefined,
}));

vi.mock('node:fs', () => ({
  readFileSync: () => {
    if (files.content === undefined) {
      throw new Error('ENOENT');
    }
    return files.content;
  },
  writeFileSync: (_file: string, data: string) => {
    files.content = data;
  },
  mkdirSync: () => {},
  rmSync: () => {},
}));

vi.mock('node:child_process', () => ({
  spawnSync: () => ({
    status: 0,
    stdout: '  `model`:\n    - "m-one"\n    - "m-two"\n  `other`:\n',
  }),
}));

vi.mock('../../src/features/cli/multiline', () => ({
  multiline: async ({ initialValue }: { initialValue?: string }) => {
    prompts.initialValues.push(initialValue ?? '');
    return prompts.texts.shift();
  },
}));

vi.mock('@clack/prompts', () => ({
  note: (message: string) => prompts.notes.push(message),
  isCancel: (value: unknown) => typeof value === 'symbol',
  log: { warn: (message: string) => prompts.warnings.push(message) },
  select: async ({
    initialValue,
    options,
  }: {
    initialValue?: string;
    options: { value: string }[];
  }) => {
    prompts.selects += 1;
    prompts.modeDefaults.push(initialValue ?? '');
    prompts.optionValues.push(options.map(({ value }) => value));
    return prompts.answers.shift();
  },
  text: async () => prompts.answers.shift(),
}));

const { confirmCopilotStart } = await import('../../src/features/cli/copilot-notice');
const { defaultInstructions, defaultModels, fixedInstructions } =
  await import('../../src/features/cli/copilot-fix');

describe('confirmCopilotStart', () => {
  beforeEach(() => {
    prompts.answers = [];
    prompts.texts = [];
    prompts.warnings = [];
    prompts.selects = 0;
    prompts.notes = [];
    prompts.initialValues = [];
    prompts.modeDefaults = [];
    prompts.optionValues = [];
    files.content = undefined;
  });

  it('appends previously used models to the defaults and remembers new ones', async () => {
    prompts.texts = ['x', 'x'];
    prompts.answers = ['interactive', 'other', 'm-two', 'interactive', 'auto'];
    await confirmCopilotStart('no-console');
    expect(JSON.parse(files.content ?? '[]')).toEqual(['m-two']);
    await confirmCopilotStart('no-console');
    expect(prompts.optionValues[4]).toEqual([...defaultModels(), 'm-two', 'other']);
  });

  it('does not repeat a default model and ignores invalid saved content', async () => {
    files.content = JSON.stringify(['auto', 'bad name', 5, 'm-one']);
    prompts.texts = ['x'];
    prompts.answers = ['interactive', 'auto'];
    await confirmCopilotStart('no-console');
    expect(prompts.optionValues[1]).toEqual([...defaultModels(), 'm-one', 'other']);
    expect(JSON.parse(files.content)).toEqual(['auto', 'm-one']);
  });

  it('offers the configured models first, then all models listed by Copilot', async () => {
    prompts.texts = ['x'];
    prompts.answers = ['interactive', 'other', 'm-two'];
    expect(await confirmCopilotStart('no-console')).toMatchObject({ model: 'm-two' });
    expect(prompts.optionValues[1]).toEqual([...defaultModels(), 'other']);
    expect(prompts.optionValues[2]).toEqual(['m-one', 'm-two', 'custom']);
  });

  it('preselects the mode configured for the rule, interactive otherwise', async () => {
    prompts.texts = ['text', 'text'];
    prompts.answers = ['plan', 'auto', 'interactive', 'auto'];
    await confirmCopilotStart('boundaries/dependencies');
    await confirmCopilotStart('no-console');
    expect(prompts.modeDefaults).toEqual(['plan', 'auto', 'interactive', 'auto']);
  });

  it('preselects the last used model, the first default model otherwise', async () => {
    prompts.texts = ['x', 'x'];
    prompts.answers = ['interactive', 'other', 'm-two', 'interactive', 'auto'];
    await confirmCopilotStart('no-console');
    await confirmCopilotStart('no-console');
    expect(prompts.modeDefaults[1]).toBe(defaultModels()[0]);
    expect(prompts.modeDefaults[4]).toBe('m-two');
  });

  it('explains how to exit and offers the default instructions to edit', async () => {
    prompts.texts = [defaultInstructions('no-console')];
    prompts.answers = ['plan', 'auto'];
    const start = await confirmCopilotStart('no-console');
    expect(start?.mode).toBe('plan');
    expect(start?.instructions).toContain('Fix only the ESLint problems of the rule no-console');
    expect(start?.instructions).not.toContain('{messageFile}');
    expect(prompts.initialValues[0]).toBe(defaultInstructions('no-console'));
    expect(prompts.initialValues[0]).toContain('\n');
    expect(prompts.notes[0]).toContain('/exit');
    expect(prompts.notes[0]).toContain('return to this CLI');
    expect(prompts.notes[0]).toContain(fixedInstructions('no-console', 'a temporary file'));
    expect(prompts.warnings).toEqual([]);
  });

  it('returns a configured model or a typed name', async () => {
    prompts.texts = ['x', 'x'];
    prompts.answers = ['interactive', 'auto', 'interactive', 'other', 'custom', ' gpt-5.6-sol '];
    expect(await confirmCopilotStart('no-console')).toMatchObject({ model: 'auto' });
    expect(await confirmCopilotStart('no-console')).toMatchObject({ model: 'gpt-5.6-sol' });
  });

  it('goes back when the model question is cancelled', async () => {
    prompts.texts = ['x'];
    prompts.answers = ['interactive', Symbol('cancel')];
    expect(await confirmCopilotStart('no-console')).toBeUndefined();
  });

  it('returns to the first model question when the full list or name is cancelled', async () => {
    prompts.texts = ['x'];
    prompts.answers = [
      'interactive',
      'other',
      Symbol('cancel'),
      'other',
      'custom',
      Symbol('cancel'),
      'auto',
    ];
    expect(await confirmCopilotStart('no-console')).toMatchObject({ model: 'auto' });
    expect(prompts.optionValues).toHaveLength(6);
  });

  it('goes back when the prompt is cancelled', async () => {
    prompts.texts = [Symbol('cancel')];
    expect(await confirmCopilotStart('no-console')).toBeUndefined();
    expect(prompts.selects).toBe(0);
  });

  it('goes back when the mode is cancelled', async () => {
    prompts.texts = ['keep the API'];
    prompts.answers = [Symbol('cancel')];
    expect(await confirmCopilotStart('no-console')).toBeUndefined();
  });

  it('returns the edited prompt', async () => {
    prompts.texts = ['keep the API'];
    prompts.answers = ['interactive', 'auto'];
    expect(await confirmCopilotStart('no-console')).toEqual({
      instructions: 'keep the API',
      mode: 'interactive',
      model: 'auto',
    });
  });

  it('sanitizes the prompt and warns about it', async () => {
    prompts.texts = ['say "hi" `now`\nsecond line'];
    prompts.answers = ['interactive', 'auto'];
    expect(await confirmCopilotStart('no-console')).toEqual({
      instructions: "say 'hi' now second line",
      mode: 'interactive',
      model: 'auto',
    });
    expect(prompts.warnings).toHaveLength(1);
  });
});
