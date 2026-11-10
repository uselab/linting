import type { ESLint } from 'eslint';
import { aliases } from '../features/eslint-presets/aliases';
import { boundaries } from '../features/eslint-presets/boundaries';
import { browser } from '../features/eslint-presets/browser';
import { javascript } from '../features/eslint-presets/javascript';
import { node } from '../features/eslint-presets/node';
import { prettier } from '../features/eslint-presets/prettier';
import { react } from '../features/eslint-presets/react';
import { typescript } from '../features/eslint-presets/typescript';
import { vue } from '../features/eslint-presets/vue';
import { vueA11yPreset } from '../features/eslint-presets/vue-a11y';
import { templateStructurePlugin } from '../support/eslint-plugins/template-structure';

/**
 * Composable Uselab ESLint presets. Spread the ones you need into your eslint.config:
 *
 * ```ts
 * export default [
 *   globalIgnores(['**\/dist/**', '**\/node_modules/**', ...]), // from 'eslint/config'
 *   ...configs.javascript(),
 *   ...configs.typescript,
 *   ...configs.vue,
 *   ...configs.browser(), // or browser({ files: ['src/**'] }) + node({ ignores: ['src/**'] })
 *   ...configs.aliases, // only when the bundler resolves the path aliases (e.g. Vite)
 *   ...configs.prettier, // always last
 * ];
 * ```
 */
export const configs = {
  javascript,
  typescript,
  vue,
  vueA11y: vueA11yPreset,
  react,
  browser,
  node,
  aliases,
  boundaries,
  prettier,
};

export const plugins: Record<'templateStructure', ESLint.Plugin> = {
  templateStructure: templateStructurePlugin,
};

export { DEFAULT_IGNORES } from '../support/ignores';
export { isDevMode } from '../support/env';
export type { Config } from '../support/shared';
export { type BoundariesOptions } from '../features/eslint-presets/boundaries';
export { type JavaScriptOptions } from '../features/eslint-presets/javascript';
export { type BrowserOptions } from '../features/eslint-presets/browser';
export { type NodeOptions } from '../features/eslint-presets/node';
