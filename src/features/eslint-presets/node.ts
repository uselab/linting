import globals from 'globals';
import type { Config } from '../../support/shared';

/**
 * Node preset: Node.js globals for all files. Use for backends, CLIs and libraries.
 * (Root-level tooling files already get Node globals from the javascript preset.)
 */
export const node: Config[] = [
  {
    name: 'uselab/node/globals',
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
