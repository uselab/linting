import type { ESLint } from 'eslint';
import { aliases } from '../features/eslint-presets/aliases';
import { boundaries } from '../features/eslint-presets/boundaries';
import { browser } from '../features/eslint-presets/browser';
import { javascript } from '../features/eslint-presets/javascript';
import { node } from '../features/eslint-presets/node';
import { prettier } from '../features/eslint-presets/prettier';
import { query } from '../features/eslint-presets/query';
import { react } from '../features/eslint-presets/react';
import { typescript } from '../features/eslint-presets/typescript';
import { vue } from '../features/eslint-presets/vue';
import { vueA11yPreset } from '../features/eslint-presets/vue-a11y';
import { templateStructurePlugin } from '../support/eslint-plugins/template-structure';

/**
 * Composable Uselab ESLint presets. Import the ones you need and spread them into your
 * eslint.config:
 *
 * ```ts
 * export default [
 *   globalIgnores(['**\/dist/**', '**\/node_modules/**', ...]), // from 'eslint/config'
 *   ...javascriptPreset(),
 *   ...typescriptPreset(),
 *   ...vuePreset(),
 *   ...browserPreset(), // or browserPreset({ files: ['src/**'] }) + nodePreset({ ignores: ['src/**'] })
 *   ...aliasesPreset(), // only when the bundler resolves the path aliases (e.g. Vite)
 *   ...nodePreset(), // after aliases: Node files may use relative imports
 *   ...prettierPreset, // always last
 * ];
 * ```
 */
export {
  aliases as aliasesPreset,
  boundaries as boundariesPreset,
  browser as browserPreset,
  javascript as javascriptPreset,
  node as nodePreset,
  prettier as prettierPreset,
  query as queryPreset,
  react as reactPreset,
  typescript as typescriptPreset,
  vue as vuePreset,
  vueA11yPreset,
};

export const plugins: Record<'templateStructure', ESLint.Plugin> = {
  templateStructure: templateStructurePlugin,
};

export { DEFAULT_IGNORES } from '../support/ignores';
export { isDevMode } from '../support/env';
export type { Config } from '../support/shared';
export { type PresetOptions } from '../support/shared';
export { type BoundariesOptions } from '../features/eslint-presets/boundaries';
export { type JavaScriptOptions } from '../features/eslint-presets/javascript';
export { type BrowserOptions } from '../features/eslint-presets/browser';
export { type NodeOptions } from '../features/eslint-presets/node';
export { type QueryOptions } from '../features/eslint-presets/query';
export { type QueryLibraryId } from '../support/query-libraries';
