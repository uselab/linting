import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCheckRule } from '../../src/features/cli/check-rule';

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

const run = async () => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
    lines.push(String(text));
    return true;
  });
  await runCheckRule('.', 'func-style');
  return lines;
};

describe('check', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('lists all problems and reports the total', async () => {
    const lines = await run();
    expect(lines).toHaveLength(91);
    expect(lines.at(-1)).toContain('90 problem(s) for func-style');
    expect(process.exitCode).toBe(1);
  });
});
