import { globalIgnores } from 'eslint/config';
import {
  boundariesPreset,
  javascriptPreset,
  nodePreset,
  prettierPreset,
  typescriptPreset,
} from '@uselab/linting';

export default [
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo']),
  ...javascriptPreset(),
  ...typescriptPreset(),
  ...nodePreset(),
  {
    // Small flat library without path aliases; the parent-import ban targets app code.
    rules: {
      'import-x/no-relative-parent-imports': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  ...boundariesPreset({ tsconfig: 'tsconfig.json' }),
  ...prettierPreset,
];
