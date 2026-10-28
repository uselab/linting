import eslintReact from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import { restrictedDomSyntaxEntries, restrictedSyntaxEntries } from '../env';
import { JSX_FILES, type Config } from '../shared';

// Hooks may live in plain .js/.ts files (e.g. use-something.ts), so React rules cover those too.
const REACT_JS_FILES = ['**/*.{js,mjs,jsx}'];
const REACT_TS_FILES = ['**/*.{ts,mts,tsx}'];
const REACT_FILES = [...REACT_JS_FILES, ...REACT_TS_FILES];

const restrictedJsxSyntax = [
  {
    selector: "JSXAttribute[name.name='style']",
    message: 'Do not use inline style props. Prefer component props and utility classes.',
  },
  {
    selector: "JSXExpressionContainer MemberExpression[object.name='props']",
    message: 'Avoid props.<name> in JSX. Destructure the props instead.',
  },
];

// @eslint-react ships its own ports of the react-hooks rules; we keep the official
// eslint-plugin-react-hooks versions and switch off the duplicates.
const duplicateHookRules = Object.fromEntries(
  Object.keys(reactHooks.rules).map((rule) => [`@eslint-react/${rule}`, 'off' as const]),
);

/**
 * React preset: @eslint-react recommended + react-hooks recommended + Uselab React house rules.
 * Components must be arrow functions (enforced by `func-style` in the javascript preset).
 */
export const react: Config[] = [
  {
    ...eslintReact.configs.recommended,
    name: 'uselab/react/recommended',
    files: REACT_JS_FILES,
  },
  {
    ...eslintReact.configs['recommended-typescript'],
    name: 'uselab/react/recommended-typescript',
    files: REACT_TS_FILES,
  },
  {
    ...reactHooks.configs.flat['recommended-latest'],
    name: 'uselab/react/hooks',
    files: REACT_FILES,
  },
  {
    name: 'uselab/react/rules',
    files: REACT_FILES,
    rules: duplicateHookRules,
  },
  {
    name: 'uselab/react/jsx-rules',
    files: JSX_FILES,
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@eslint-react/jsx-no-useless-fragment': 'error',
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntaxEntries,
        ...restrictedDomSyntaxEntries,
        ...restrictedJsxSyntax,
      ],
    },
  },
];
