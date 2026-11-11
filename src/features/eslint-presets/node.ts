import globals from 'globals';
import { scope, type Config, type PresetOptions } from '../../support/shared';

/** `files` are the Node files (default: all files); `ignores` e.g. the browser files. */
export type NodeOptions = PresetOptions;

/**
 * Node preset: Node.js globals, for all files by default. Use for backends, CLIs and libraries,
 * or with `ignores` for the non-browser files of a browser project.
 * (Root-level tooling files already get Node globals from the javascript preset.)
 *
 * Node doesn't resolve the `@app` / `@features` / `@support` aliases, so its files may use
 * relative imports: this turns off the `no-restricted-imports` rule of the aliases preset for them.
 * Place it after `aliases`. Layout boundaries are still checked by `boundaries()`.
 */
export const node = (options: NodeOptions = {}): Config[] => [
  {
    name: 'uselab/node/globals',
    ...scope(options.files, options.ignores),
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    name: 'uselab/node/relative-imports',
    ...scope(options.files, options.ignores),
    rules: { 'no-restricted-imports': 'off' },
  },
];
