import globals from 'globals';
import { restrictedDomSyntaxEntries, restrictedSyntaxEntries } from '../env';
import { JSX_FILES, SOURCE_FILES, type Config } from '../shared';

const ATTRIBUTE_HINT =
  'Prefer reactive bindings. If unavoidable, document with an explicit eslint exception comment.';

/**
 * Browser preset: browser globals + UI enforcement rules (no imperative DOM class/attribute
 * mutation) for files under src/.
 */
export const browser: Config[] = [
  {
    name: 'uselab/browser/globals',
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    name: 'uselab/browser/ui-enforcement',
    files: SOURCE_FILES,
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'setAttribute',
          message: `Do not use setAttribute directly. ${ATTRIBUTE_HINT}`,
        },
        {
          property: 'removeAttribute',
          message: `Do not use removeAttribute directly. ${ATTRIBUTE_HINT}`,
        },
      ],
    },
  },
  {
    // Rule options replace each other, so the base entries are repeated here. JSX files get
    // these entries from the react preset, which keeps the result independent of preset order.
    name: 'uselab/browser/restricted-syntax',
    files: SOURCE_FILES,
    ignores: JSX_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...restrictedSyntaxEntries, ...restrictedDomSyntaxEntries],
    },
  },
];
