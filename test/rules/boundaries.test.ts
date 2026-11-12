import type { Linter } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aliasesPreset,
  boundariesPreset,
  javascriptPreset,
  typescriptPreset,
  type BoundariesOptions,
} from '../../src/app';
import { OUTSIDE_IMPORT_MESSAGE } from '../../src/support/eslint-plugins/layout';
import { fixturePath, lintFixture, ruleIds, type LintReport } from '../helpers';

const RULE = 'boundaries/dependencies';
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

/** Lints a fixture from its own directory, like running ESLint in the project. */
const lint = async (
  options: BoundariesOptions = {},
  fixture = 'boundaries',
  { aliases = true } = {},
): Promise<LintReport> => {
  process.chdir(fixturePath(fixture));
  return lintFixture(fixture, [
    ...javascriptPreset(),
    ...typescriptPreset(),
    ...(aliases ? aliasesPreset() : []),
    ...boundariesPreset(options),
  ]);
};

const boundaryMessages = (report: LintReport, file: string): Linter.LintMessage[] =>
  (report[file] ?? []).filter((message) => message.ruleId === RULE);

const boundaryLines = (report: LintReport, file: string): number[] =>
  boundaryMessages(report, file).map((message) => message.line);

describe('default policies', () => {
  it.each([
    ['feature -> feature', 'src/features/orders/index.ts', 2],
    ['feature -> app', 'src/features/customers/uses-app.ts', 1],
    ['support -> feature', 'src/support/format.ts', 1],
    ['support -> app', 'src/support/uses-app.ts', 1],
  ])('reports %s', async (_label, file, line) => {
    const report = await lint();
    expect(boundaryLines(report, file)).toEqual([line]);
  });

  it.each([
    ['app -> feature', 'src/app/main.ts'],
    ['imports inside a feature', 'src/features/orders/order-item.ts'],
  ])('allows %s', async (_label, file) => {
    const report = await lint();
    expect(boundaryMessages(report, file)).toEqual([]);
  });

  it('with the aliases preset: reports parent-relative imports, allows aliases', async () => {
    const report = await lint();
    expect(
      (report['src/features/orders/index.ts'] ?? [])
        .filter((message) => message.ruleId === 'no-restricted-imports')
        .map((message) => message.line),
    ).toEqual([1, 2]);
    expect(ruleIds(report, 'src/features/customers/alias.ts')).not.toContain(
      'no-restricted-imports',
    );
  });

  it('without the aliases preset: still reports parent-relative imports across boundaries', async () => {
    const report = await lint({}, 'boundaries', { aliases: false });
    expect(ruleIds(report, 'src/features/orders/index.ts')).not.toContain('no-restricted-imports');
    expect(boundaryLines(report, 'src/features/orders/index.ts')).toEqual([2]);
  });
});

describe('tsconfig', () => {
  it('resolves path aliases with the tsconfig found automatically', async () => {
    const report = await lint();
    expect(boundaryLines(report, 'src/features/customers/alias.ts')).toEqual([1]);
  });

  it('picks the tsconfig that includes src, not tsconfig.node.json', async () => {
    const report = await lint({}, 'boundaries-vite');
    expect(boundaryLines(report, 'src/features/customers/index.ts')).toEqual([1]);
  });

  it('uses the tsconfig option when given', async () => {
    const report = await lint({ tsconfig: 'tsconfig.node.json' }, 'boundaries-vite');
    expect(boundaryMessages(report, 'src/features/customers/index.ts')).toEqual([]);
  });
});

describe('srcDirs', () => {
  const srcDirs = ['web/src', 'admin/src'];

  it('applies the layout in every src dir, resolving aliases with its own tsconfig', async () => {
    const report = await lint({ srcDirs }, 'boundaries-multi');
    expect(boundaryLines(report, 'web/src/features/cart/index.ts')).toEqual([1]);
    expect(boundaryMessages(report, 'admin/src/app/main.ts')).toEqual([]);
  });

  it('reports imports between src dirs, also between features with the same name', async () => {
    const report = await lint({ srcDirs }, 'boundaries-multi');
    expect(boundaryLines(report, 'web/src/app/uses-admin.ts')).toEqual([1]);
    const [message] = boundaryMessages(report, 'admin/src/features/shared/index.ts');
    const [betweenSrcDirs] = boundaryMessages(report, 'web/src/app/uses-admin.ts');
    expect(message?.message).toBe(betweenSrcDirs?.message);
  });

  it('only checks the listed src dirs', async () => {
    const report = await lint({ srcDirs: ['web/src'] }, 'boundaries-multi');
    expect(boundaryLines(report, 'web/src/features/cart/index.ts')).toEqual([1]);
    expect(boundaryMessages(report, 'admin/src/features/shared/index.ts')).toEqual([]);
  });

  it('accepts ./ prefixes and trailing slashes', async () => {
    const report = await lint({ srcDirs: ['./src/'] });
    expect(boundaryLines(report, 'src/support/format.ts')).toEqual([1]);
  });

  it('rejects nested src dirs', () => {
    expect(() => boundariesPreset({ srcDirs: ['src', './src/features/x/src/'] })).toThrow(
      'Boundaries cannot be nested',
    );
    expect(() => boundariesPreset({ srcDirs: ['web/src', 'web/src-admin'] })).not.toThrow();
  });
});

describe('file location', () => {
  const LOCATION_RULE = 'uselab-layout/file-location';
  const locationMessages = (report: LintReport, file: string): Linter.LintMessage[] =>
    (report[file] ?? []).filter((message) => message.ruleId === LOCATION_RULE);

  it.each(['src/main.ts', 'src/router/index.ts', 'src/router/types.d.ts'])(
    'reports %s outside app/, features/ and support/',
    async (file) => {
      const report = await lint();
      expect(locationMessages(report, file).map((message) => message.messageId)).toEqual([
        'outsideLayout',
      ]);
    },
  );

  it.each([
    'src/env.d.ts',
    'src/app/main.ts',
    'src/features/orders/index.ts',
    'src/support/format.ts',
  ])('allows %s', async (file) => {
    const report = await lint();
    expect(ruleIds(report, file)).not.toContain(LOCATION_RULE);
    expect(locationMessages(report, file)).toEqual([]);
  });

  it('names the src folder and only checks the listed src folders', async () => {
    const report = await lint({ srcDirs: ['web/src', 'admin/src'] }, 'boundaries-multi');
    expect(locationMessages(report, 'web/src/main.ts')[0]?.message).toContain('web/src/');
    expect(locationMessages(report, 'web/src/app/uses-admin.ts')).toEqual([]);
    const onlyAdmin = await lint({ srcDirs: ['admin/src'] }, 'boundaries-multi');
    expect(locationMessages(onlyAdmin, 'web/src/main.ts')).toEqual([]);
  });
});

describe('imports from outside app/, features/ and support/', () => {
  const IMPORT_RULE = 'uselab-layout/import-location';
  const outsideLines = (report: LintReport, file: string): number[] =>
    (report[file] ?? [])
      .filter(
        (message) =>
          [RULE, IMPORT_RULE].includes(message.ruleId ?? '') &&
          message.message.startsWith(OUTSIDE_IMPORT_MESSAGE),
      )
      .map((message) => message.line);

  it('reports relative, alias and path-style imports (/src/x, src/x) of those files', async () => {
    const report = await lint();
    expect(outsideLines(report, 'src/app/imports-outside.ts')).toEqual([1, 2, 3, 4, 6]);
  });

  it('checks export ... from and import() in features too, allowing paths into the layout', async () => {
    const report = await lint();
    expect(outsideLines(report, 'src/features/customers/imports-outside.ts')).toEqual([1, 3]);
  });

  it('does not report imports between files outside the layout', async () => {
    const report = await lint();
    expect(outsideLines(report, 'src/main.ts')).toEqual([]);
  });

  it('matches /src/x and the full src folder path with several src folders', async () => {
    const report = await lint({ srcDirs: ['web/src', 'admin/src'] }, 'boundaries-multi');
    expect(outsideLines(report, 'web/src/app/imports-outside.ts')).toEqual([1, 2]);
  });
});
