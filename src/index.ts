import type { ESLint } from 'eslint';
import { boundaries } from './configs/boundaries';
import { browser } from './configs/browser';
import { ignores } from './configs/ignores';
import { javascript } from './configs/javascript';
import { node } from './configs/node';
import { prettier } from './configs/prettier';
import { react } from './configs/react';
import { typescript } from './configs/typescript';
import { vue } from './configs/vue';
import { templateStructurePlugin } from './plugins/template-structure';

/**
 * Composable Uselab ESLint presets. Spread the ones you need into your eslint.config:
 *
 * ```ts
 * export default [
 *   ...configs.ignores(),
 *   ...configs.javascript,
 *   ...configs.typescript,
 *   ...configs.vue,
 *   ...configs.browser,
 *   ...configs.prettier, // always last
 * ];
 * ```
 */
export const configs = {
  ignores,
  javascript,
  typescript,
  vue,
  react,
  browser,
  node,
  boundaries,
  prettier,
};

export const plugins: Record<'templateStructure', ESLint.Plugin> = {
  templateStructure: templateStructurePlugin,
};

export { isDevMode } from './env';
export type { Config } from './shared';
export {
  defaultBoundaryElements,
  defaultBoundaryPolicies,
  type BoundariesOptions,
  type BoundaryElement,
  type BoundaryPolicy,
} from './configs/boundaries';
