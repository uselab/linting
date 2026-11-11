import type { ASTNode } from 'magicast';
import { DEFAULT_IGNORES } from '../../support/ignores';
import { stringArray } from './eslint-config-literals';
import { IGNORE_EVERYTHING, KEEP_TOOLING_FILES, type IgnoresAnswers } from './generate';

export const ALL_FILES: IgnoresAnswers = { mode: 'all', globs: [] };

const isDefaultIgnore = (pattern: string): boolean => DEFAULT_IGNORES.includes(pattern);

/**
 * Reads opt-in patterns (`'**\/*', '!**\/*\/', '!src/**', 'src/legacy/**'`) back to their globs:
 * the negated patterns are the linted globs, the patterns after them the skipped `!globs`.
 */
const readOptIn = (patterns: string[]): IgnoresAnswers | undefined => {
  const rest = patterns.filter(
    (pattern) => !IGNORE_EVERYTHING.includes(pattern) && pattern !== KEEP_TOOLING_FILES,
  );
  const firstSkipped = rest.findIndex((pattern) => !pattern.startsWith('!'));
  const linted = firstSkipped === -1 ? rest : rest.slice(0, firstSkipped);
  const skipped = firstSkipped === -1 ? [] : rest.slice(firstSkipped);
  if (linted.length === 0 || skipped.some((pattern) => pattern.startsWith('!'))) {
    return undefined;
  }
  return {
    mode: 'only',
    globs: [...linted.map((pattern) => pattern.slice(1)), ...skipped.map((glob) => `!${glob}`)],
  };
};

/** Maps the scope patterns (without the defaults) to the lint scope. */
const readScope = (patterns: string[]): IgnoresAnswers | undefined => {
  if (patterns.length === 0) {
    return ALL_FILES;
  }
  if (IGNORE_EVERYTHING.every((pattern) => patterns.includes(pattern))) {
    return readOptIn(patterns);
  }
  return { mode: 'exclude', globs: patterns };
};

/** Reads `globalIgnores([...])`` (and an optional name) with literal patterns into the lint scope. */
export const readGlobalIgnores = (node: ASTNode): IgnoresAnswers | undefined => {
  if (node.type !== 'CallExpression' || node.arguments.length === 0 || node.arguments.length > 2) {
    return undefined;
  }
  const [argument] = node.arguments;
  const patterns = argument ? stringArray(argument) : undefined;
  return patterns === undefined
    ? undefined
    : readScope(patterns.filter((pattern) => !isDefaultIgnore(pattern)));
};
