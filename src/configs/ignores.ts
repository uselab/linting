import type { Config } from '../shared';

const DEFAULT_IGNORES = ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.tsbuildinfo'];

/**
 * Global ignores. Pass extra glob patterns to ignore more paths.
 */
export const ignores = (extra: string[] = []): Config[] => [
  {
    name: 'uselab/ignores',
    ignores: [...DEFAULT_IGNORES, ...extra],
  },
];
