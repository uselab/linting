import globals from 'globals';
import { scope, type Config } from '../../support/shared';

export type NodeOptions = {
  /** Globs of the Node files. Default: all files. */
  files?: string[];
  /** Globs of files that don't get the Node globals, e.g. the browser files. */
  ignores?: string[];
};

/**
 * Node preset: Node.js globals, for all files by default. Use for backends, CLIs and libraries,
 * or with `ignores` for the non-browser files of a browser project.
 * (Root-level tooling files already get Node globals from the javascript preset.)
 */
export const node = (options: NodeOptions = {}): Config[] => [
  {
    name: 'uselab/node/globals',
    ...scope(options.files, options.ignores),
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
