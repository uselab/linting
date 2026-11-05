import { writeFileSync } from 'node:fs';
import * as clack from '@clack/prompts';
import type { InitAnswers } from './generate';
import { typecheckCommand } from './scripts';
import { typecheckTarget, type TsconfigInfo } from './tsconfig';
import {
  addViteChecker,
  findViteConfig,
  hasViteChecker,
  VITE_CHECKER,
  viteCheckerSnippet,
} from './vite';

/** The `typecheck` command for the typescript preset; warns when there is no tsconfig. */
export const typecheckScript = (projectDir: string, answers: InitAnswers): string | undefined => {
  if (!answers.presets.includes('typescript')) {
    return undefined;
  }
  const target = typecheckTarget(projectDir);
  if (!target) {
    clack.log.warn('No tsconfig.json found; add one and a "typecheck": "tsc --noEmit" script.');
    return undefined;
  }
  return typecheckCommand(target, answers.presets.includes('vue'));
};

/**
 * Adds vite-plugin-checker (types + ESLint in the dev overlay) for the typescript preset. Returns
 * whether the project uses (or should use) the plugin, so it is added as a dependency.
 */
export const updateViteChecker = (
  projectDir: string,
  answers: InitAnswers,
  tsconfig: TsconfigInfo | undefined,
): boolean => {
  const viteConfig = findViteConfig(projectDir);
  if (!viteConfig || !answers.presets.includes('typescript')) {
    return false;
  }
  if (hasViteChecker(viteConfig.text)) {
    clack.log.info(`${viteConfig.file} already uses ${VITE_CHECKER}; left unchanged.`);
    return true;
  }
  const options = { vue: answers.presets.includes('vue'), tsconfig: tsconfig?.file };
  const patched = addViteChecker(viteConfig.text, options);
  if (patched === undefined) {
    clack.log.warn(`Can't update ${viteConfig.file} automatically; add ${VITE_CHECKER} manually.`);
    clack.note(viteCheckerSnippet(options), `Add ${VITE_CHECKER} to ${viteConfig.file}`);
    return true;
  }
  writeFileSync(viteConfig.absolutePath, patched);
  clack.log.success(`Added ${VITE_CHECKER} to ${viteConfig.file}.`);
  return true;
};
