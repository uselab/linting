import { globalIgnores } from 'eslint/config';
import {
  boundariesPreset,
  javascriptPreset,
  nodePreset,
  prettierPreset,
  typescriptPreset,
} from '@uselab/linting';
import { disableWarnings } from './src/features/eslint-presets/disable-warnings.ts';

export default disableWarnings([
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
]);
