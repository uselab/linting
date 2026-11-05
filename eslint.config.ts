import { globalIgnores } from 'eslint/config';
import { configs } from '@uselab/linting';

export default [
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.tsbuildinfo']),
  ...configs.javascript(),
  ...configs.typescript,
  ...configs.node,
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
  ...configs.boundaries({ tsconfig: 'tsconfig.json' }),
  ...configs.prettier,
];
