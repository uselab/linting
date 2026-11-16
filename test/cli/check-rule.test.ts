import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCheckRule } from '../../src/features/cli/check-rule';
import { parseMaxErrors } from '../../src/features/cli/run';

vi.mock('../../src/features/cli/analyze', () => ({
  lintProject: async () => [],
  collectProblems: () =>
    Array.from({ length: 90 }, (_, index) => ({
      file: 'a.ts',
      line: index + 1,
      column: 1,
      message: 'm',
      severity: 2,
      ruleId: 'func-style',
    })),
}));

const run = async (maxErrors?: number) => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
    lines.push(String(text));
    return true;
  });
  await runCheckRule('.', 'func-style', { maxErrors });
  return lines;
};

describe('check --max-errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('lists 50 problems by default and reports the total', async () => {
    const lines = await run();
    expect(lines).toHaveLength(51);
    expect(lines.at(-1)).toContain('Only first 50 errors of 90 total for func-style');
    expect(process.exitCode).toBe(1);
  });

  it('uses a custom limit', async () => {
    const lines = await run(5);
    expect(lines.at(-1)).toContain('Only first 5 errors of 90 total');
  });

  it('prints the plain summary when everything fits', async () => {
    const lines = await run(100);
    expect(lines.at(-1)).toContain('90 problem(s) for func-style');
  });

  it('parses both argument forms', () => {
    expect(parseMaxErrors(['check', 'r'])).toBeUndefined();
    expect(parseMaxErrors(['check', 'r', '--max-errors', '5'])).toBe(5);
    expect(parseMaxErrors(['check', 'r', '--max-errors=7'])).toBe(7);
    expect(parseMaxErrors(['check', 'r', '--max-errors=0'])).toBeNaN();
    expect(parseMaxErrors(['check', 'r', '--max-errors'])).toBeNaN();
  });
});
