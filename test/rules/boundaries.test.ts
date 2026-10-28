import type { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { configs, defaultBoundaryElements, type BoundariesOptions } from '../../src';
import { fixturePath, lintFixture, ruleIds, type LintReport } from '../helpers';

const rootPath = fixturePath('boundaries');
const RULE = 'boundaries/dependencies';

const lint = async (options: BoundariesOptions): Promise<LintReport> =>
  lintFixture('boundaries', [
    ...configs.javascript,
    ...configs.typescript,
    ...configs.boundaries(options),
  ]);

const boundaryMessages = (report: LintReport, file: string): Linter.LintMessage[] =>
  (report[file] ?? []).filter((message) => message.ruleId === RULE);

describe('default policies', () => {
  it.each([
    ['feature -> feature', 'src/features/orders/index.ts', 2],
    ['feature -> app', 'src/features/customers/uses-app.ts', 1],
    ['support -> feature', 'src/support/format.ts', 1],
    ['support -> app', 'src/support/uses-app.ts', 1],
  ])('reports %s', async (_label, file, line) => {
    const report = await lint({ rootPath });
    expect(boundaryMessages(report, file).map((message) => message.line)).toEqual([line]);
  });

  it.each([
    ['app -> feature', 'src/app/main.ts'],
    ['imports inside a feature', 'src/features/orders/order-item.ts'],
  ])('allows %s', async (_label, file) => {
    const report = await lint({ rootPath });
    expect(boundaryMessages(report, file)).toEqual([]);
  });

  it('turns off import-x/no-relative-parent-imports for boundary files', async () => {
    const report = await lint({ rootPath });
    expect(ruleIds(report, 'src/features/orders/index.ts')).not.toContain(
      'import-x/no-relative-parent-imports',
    );
  });
});

describe('options', () => {
  it('policies: replaces the default policies', async () => {
    const report = await lint({ rootPath, policies: [] });
    for (const messages of Object.values(report)) {
      expect(messages.filter((message) => message.ruleId === RULE)).toEqual([]);
    }
  });

  it('elements: replaces the default elements', async () => {
    const elements = defaultBoundaryElements.map((element) =>
      element.type === 'support' ? { ...element, type: 'shared' } : element,
    );
    const report = await lint({ rootPath, elements });
    expect(boundaryMessages(report, 'src/support/format.ts')).toEqual([]);
    expect(boundaryMessages(report, 'src/features/orders/index.ts')).toHaveLength(1);
  });

  it('files: limits the files the rules apply to', async () => {
    const report = await lint({ rootPath, files: ['src/support/**/*.ts'] });
    expect(boundaryMessages(report, 'src/support/format.ts')).toHaveLength(1);
    expect(boundaryMessages(report, 'src/features/orders/index.ts')).toEqual([]);
  });

  it('include: limits the files boundaries classifies', async () => {
    const report = await lint({ rootPath, include: ['src/features/**'] });
    expect(boundaryMessages(report, 'src/features/orders/index.ts')).toHaveLength(1);
    expect(boundaryMessages(report, 'src/support/format.ts')).toEqual([]);
  });

  it('tsconfig: resolves path aliases', async () => {
    const report = await lint({ rootPath, tsconfig: fixturePath('boundaries/tsconfig.json') });
    expect(boundaryMessages(report, 'src/features/customers/alias.ts')).toHaveLength(1);
  });

  it('rootPath: element patterns are relative to it (default: process.cwd())', async () => {
    const report = await lint({});
    expect(boundaryMessages(report, 'src/features/orders/index.ts')).toEqual([]);
  });
});
