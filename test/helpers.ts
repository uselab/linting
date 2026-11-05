import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { expect, vi } from 'vitest';
import type { Config, configs as Configs } from '../src/app';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const fixturePath = (fixture: string): string => path.join(fixturesDir, fixture);

export type LintReport = Record<string, Linter.LintMessage[]>;

const assertNoParseErrors = (messages: Linter.LintMessage[], file: string): void => {
  const fatal = messages.filter((message) => message.fatal);
  expect(fatal, `parse errors in ${file}`).toEqual([]);
};

/** Lints every file in a fixture directory. */
export const lintFixture = async (fixture: string, config: Config[]): Promise<LintReport> => {
  const cwd = fixturePath(fixture);
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: config });
  const results = await eslint.lintFiles(['.']);
  const report: LintReport = {};
  for (const result of results) {
    assertNoParseErrors(result.messages, result.filePath);
    report[path.relative(cwd, result.filePath).replaceAll('\\', '/')] = result.messages;
  }
  return report;
};

/**
 * Lints a code snippet as if it were the file `filePath` (relative to the snippets fixture).
 */
export const lintSnippet = async (
  config: Config[],
  filePath: string,
  code: string,
): Promise<Linter.LintMessage[]> => {
  const cwd = fixturePath('snippets');
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText(code, { filePath: path.join(cwd, filePath) });
  const messages = result?.messages ?? [];
  assertNoParseErrors(messages, filePath);
  return messages;
};

export const isIgnored = async (config: Config[], filePath: string): Promise<boolean> => {
  const eslint = new ESLint({
    cwd: fixturePath('snippets'),
    overrideConfigFile: true,
    overrideConfig: config,
  });
  return eslint.isPathIgnored(path.join(fixturePath('snippets'), filePath));
};

/** Messages reported by a single rule. */
export const byRule = (messages: Linter.LintMessage[], ruleId: string): Linter.LintMessage[] =>
  messages.filter((message) => message.ruleId === ruleId);

/** Lints a snippet and returns only the messages of `ruleId`: `lintRule(config, rule)(file, code)`. */
export const lintRule =
  (config: Config[], ruleId: string) =>
  async (filePath: string, code: string): Promise<Linter.LintMessage[]> =>
    byRule(await lintSnippet(config, filePath, code), ruleId);

export const ruleIds = (report: LintReport, file: string): string[] => {
  const messages = report[file];
  if (!messages) {
    throw new Error(`File ${file} was not linted. Linted: ${Object.keys(report).join(', ')}`);
  }
  return messages.map((message) => message.ruleId ?? '<none>');
};

/** Effective config for a file, resolved by ESLint. */
export const configForFile = async (config: Config[], filePath: string): Promise<Linter.Config> => {
  const cwd = fixturePath('snippets');
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: config });
  const resolved: Linter.Config | undefined = await eslint.calculateConfigForFile(
    path.join(cwd, filePath),
  );
  return resolved ?? {};
};

/** Numeric severity of a rule in a resolved config (0 = off, 1 = warn, 2 = error). */
export const severityOf = (resolved: Linter.Config, ruleId: string): number | undefined => {
  const entry = resolved.rules?.[ruleId];
  const level: unknown = Array.isArray(entry) ? entry[0] : entry;
  if (level === undefined) {
    return undefined;
  }
  return typeof level === 'number' ? level : { off: 0, warn: 1, error: 2 }[String(level)];
};

/** Re-imports the presets with the given environment, since dev mode is evaluated at load time. */
export const loadConfigs = async (env: Record<string, string>): Promise<typeof Configs> => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  try {
    const module = await import('../src/app');
    return module.configs;
  } finally {
    vi.unstubAllEnvs();
  }
};

/** Generates `count` lines of simple statements. */
export const statements = (count: number, indent = ''): string =>
  Array.from({ length: count }, (_, index) => `${indent}foo${index}();`).join('\n');
