import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import type { Problem } from './analyze';
import { findEslintConfigFile, writeDisabledRules } from './disable-rules';
import { readEslintConfig, updateEslintIgnores } from './eslint-config';
import { ignoreProblems } from './ignore-comments';
import { askScopeGlobs } from './prompts';
import { askRuleActions, type RuleChoice } from './rule-actions-prompt';

const rulesWith = (actions: Map<string, string>, wanted: string): string[] =>
  [...actions].flatMap(([ruleId, action]) => (action === wanted ? [ruleId] : []));

const ignoreRules = (projectDir: string, ruleIds: string[], problems: Problem[]): boolean => {
  const { files, comments, skipped } = ignoreProblems(
    projectDir,
    problems.filter(({ ruleId }) => ruleIds.includes(ruleId)),
  );
  if (comments > 0) {
    const count = `${comments} comment${comments === 1 ? '' : 's'}`;
    clack.log.success(`Added ${count} to ${files.length} file${files.length === 1 ? '' : 's'}.`);
  }
  if (skipped.length > 0) {
    clack.log.warn(
      `Couldn't add comments for:\n${skipped.map(({ file, line, ruleId }) => `${file}:${line} ${ruleId}`).join('\n')}`,
    );
  }
  return comments > 0;
};

/** The ESLint config with a lint scope that can be rewritten, if any. */
const editableConfig = async (projectDir: string) => {
  const file = await findEslintConfigFile(projectDir);
  const text = file ? readFileSync(file, 'utf8') : undefined;
  const ignores = text === undefined ? undefined : readEslintConfig(text);
  return {
    name: file ? path.relative(projectDir, file) : 'the ESLint config',
    config:
      file && text !== undefined && ignores?.ignoresEditable
        ? { file, text, ignores: ignores.ignores ?? { mode: 'all' as const, globs: [] } }
        : undefined,
  };
};

/**
 * Asks for the globs of the lint scope in the `globalIgnores()` entry and rewrites it. Without a
 * `@uselab/linting` config with literal patterns, it only says where to change them by hand.
 * Returns whether the config was changed.
 */
export const editGlobalIgnores = async (projectDir: string): Promise<boolean> => {
  const { name, config } = await editableConfig(projectDir);
  if (!config) {
    clack.log.warn(
      `Can't edit the ignores in ${name} automatically; change the globalIgnores([...]) entry by hand.`,
    );
    return false;
  }
  const configFile = config.file;
  const configDir = path.dirname(configFile);
  const ignores = await askScopeGlobs(
    config.ignores,
    path.resolve(configDir) === path.resolve(projectDir) ? undefined : configDir,
  );
  const update = updateEslintIgnores(config.text, ignores);
  if (!update?.updated) {
    clack.log.info(`The ignores in ${name} are unchanged.`);
    return false;
  }
  writeFileSync(configFile, update.code);
  clack.log.success(`Updated the ignores in ${name}.`);
  return true;
};

/** Asks for the rule actions once and applies them. */
const applyRuleActionsOnce = async (
  projectDir: string,
  choices: RuleChoice[],
  problems: Problem[],
): Promise<{ changed: boolean; editIgnores: boolean }> => {
  const { actions, editIgnores } = await askRuleActions(choices);
  const disable = rulesWith(actions, 'disable');
  const ignore = rulesWith(actions, 'ignore');
  const disabled = disable.length > 0 && (await writeDisabledRules(projectDir, disable));
  const ignored = ignore.length > 0 && ignoreRules(projectDir, ignore, problems);
  const ignoresEdited = editIgnores && (await editGlobalIgnores(projectDir));
  return { changed: disabled || ignored || ignoresEdited, editIgnores };
};

/**
 * Asks per rule whether to keep it, disable it in the ESLint config, or ignore its problems with
 * `eslint-disable-next-line` comments, and applies the choices. Then edits the ignores when
 * asked for; when that changes nothing, it asks for the rule actions again. Returns whether
 * anything changed.
 */
export const applyRuleActions = async (
  projectDir: string,
  choices: RuleChoice[],
  problems: Problem[],
): Promise<boolean> => {
  if (choices.length === 0) {
    return false;
  }
  for (;;) {
    const { changed, editIgnores } = await applyRuleActionsOnce(projectDir, choices, problems);
    if (changed || !editIgnores) {
      return changed;
    }
  }
};
