import globals from 'globals';
import { restrictedDomSyntaxEntries, restrictedSyntaxEntries } from '../../support/env';
import { JSX_FILES, scope, SOURCE_FILES, type Config } from '../../support/shared';

const ATTRIBUTE_HINT =
  'Prefer reactive bindings. If unavoidable, document with an explicit eslint exception comment.';

export type BrowserOptions = {
  /**
   * Globs of the browser files, which get the browser globals and the UI enforcement rules.
   * Default: browser globals for all files and the UI enforcement rules for `src/`.
   */
  files?: string[];
  /** Globs of files that don't get the browser globals and rules. */
  ignores?: string[];
};

/**
 * Browser preset: browser globals + UI enforcement rules (no imperative DOM class/attribute
 * mutation). Without options, the globals apply to all files and the rules to files under src/.
 */
export const browser = (options: BrowserOptions = {}): Config[] => {
  const { files, ignores = [] } = options;
  const ruleFiles = files ?? SOURCE_FILES;
  return [
    {
      name: 'uselab/browser/globals',
      ...scope(files, options.ignores),
      languageOptions: {
        globals: { ...globals.browser },
      },
    },
    {
      name: 'uselab/browser/ui-enforcement',
      ...scope(ruleFiles, options.ignores),
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
      files: ruleFiles,
      ignores: [...JSX_FILES, ...ignores],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...restrictedSyntaxEntries,
          ...restrictedDomSyntaxEntries,
        ],
      },
    },
  ];
};
