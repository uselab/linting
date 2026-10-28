import { configs } from './src';

export default [
  ...configs.ignores(['test/fixtures/**']),
  ...configs.javascript,
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
  ...configs.prettier,
];
