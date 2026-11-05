import { writeFileSync } from 'node:fs';
import * as clack from '@clack/prompts';
import type { InitAnswers } from './generate';
import {
  addMissingAliases,
  checkAliases,
  findSourceTsconfig,
  pathsSnippet,
  type TsconfigInfo,
} from './tsconfig';
import { addViteAliases, checkViteAliases, findViteConfig, viteAliasSnippet } from './vite';
/** Adds the @app / @features / @support path aliases needed by the aliases preset. */
const updateTsconfig = (
  projectDir: string,
  tsconfig: TsconfigInfo | undefined,
  srcDir = 'src',
): void => {
  if (!tsconfig) {
    clack.log.warn(
      `No tsconfig found for ${srcDir}. Parent-relative imports are not allowed, so set up path aliases (tsconfig.json or jsconfig.json):`,
    );
    clack.note(pathsSnippet(srcDir), 'path aliases');
    return;
  }
  const report = checkAliases(projectDir, tsconfig, srcDir);
  const missing = report.checks.filter(({ status }) => status === 'missing');
  for (const check of report.checks.filter(({ status }) => status === 'conflict')) {
    clack.log.warn(
      `${tsconfig.file}: ${check.alias} maps to ${JSON.stringify(check.actual)}, expected ${check.expected}. Left unchanged.`,
    );
  }
  if (missing.length === 0) {
    return;
  }
  const list = missing.map(({ alias, expected }) => `${alias} → ${expected}`).join('\n');
  if (!report.editable) {
    clack.note(list, `Missing path aliases in ${tsconfig.file}`);
    clack.log.warn('paths is inherited via "extends"; add the aliases there manually.');
    return;
  }
  writeFileSync(tsconfig.absolutePath, addMissingAliases(tsconfig.text, report.checks));
  clack.note(list, `Added path aliases to ${tsconfig.file}`);
};

/** Vite doesn't read tsconfig paths, so the same aliases are needed in `resolve.alias`. */
export const updateViteConfig = (projectDir: string): void => {
  const viteConfig = findViteConfig(projectDir);
  if (!viteConfig) {
    return;
  }
  const report = checkViteAliases(viteConfig.text);
  if (report.missing.length === 0) {
    return;
  }
  const patched = report.supported ? addViteAliases(viteConfig.text) : undefined;
  if (patched === undefined) {
    clack.log.warn(`Can't update ${viteConfig.file} automatically; add the aliases manually.`);
    clack.note(viteAliasSnippet(), `Add the aliases to ${viteConfig.file}`);
    return;
  }
  writeFileSync(viteConfig.absolutePath, patched);
  clack.note(report.missing.join('\n'), `Added aliases to ${viteConfig.file}`);
};

/** Adds the path aliases to the tsconfig of each src folder (the boundaries ones, else `src`). */
export const updateSourceTsconfigs = (projectDir: string, answers: InitAnswers): void => {
  const srcDirs = answers.boundaries?.srcDirs ?? ['src'];
  for (const srcDir of srcDirs) {
    updateTsconfig(projectDir, findSourceTsconfig(projectDir, srcDir), srcDir);
  }
};
