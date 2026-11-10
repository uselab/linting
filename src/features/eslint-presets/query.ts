import tseslint from 'typescript-eslint';
import { restrictedAttributeProperties } from '../../support/env';
import {
  DEFAULT_QUERY_ALLOW,
  HTTP_CLIENT_PACKAGES,
  queryLibrary,
  type QueryLibraryId,
} from '../../support/query-libraries';
import { SOURCE_FILES, type Config } from '../../support/shared';

export type QueryOptions = {
  /** The server-state library the messages point to. Default: a generic hint. */
  library?: QueryLibraryId;
  /** Globs where raw HTTP is allowed (the fetcher the query library calls). Default: `src/support/http/**`. */
  allow?: string[];
  /** Globs the rules apply to. Default: all source files under `src/`. */
  files?: string[];
};

const FETCH_GLOBALS = ['window', 'globalThis', 'self'];

/**
 * Query preset: no `fetch` and no HTTP client libraries outside `allow`, so server state goes
 * through a query library (TanStack Query, SWR, ...) with caching, deduplication and retries.
 * Rule options replace each other, so the attribute entries of the browser preset are repeated
 * in `no-restricted-properties`. The import ban uses the `@typescript-eslint` variant of
 * `no-restricted-imports`, which doesn't clash with the aliases preset.
 */
export const query = (options: QueryOptions = {}): Config[] => {
  const { library, allow = DEFAULT_QUERY_ALLOW, files = SOURCE_FILES } = options;
  const hint = library === undefined ? 'a query library' : queryLibrary(library).usage;
  const fetchMessage = `Do not call fetch directly. Use ${hint}; raw HTTP belongs in ${allow.join(', ')}.`;
  const clientMessage = `Do not use HTTP client libraries. Use ${hint}; raw HTTP belongs in ${allow.join(', ')}.`;
  return [
    {
      name: 'uselab/query/no-raw-http',
      files,
      ignores: allow,
      plugins: { '@typescript-eslint': tseslint.plugin },
      rules: {
        'no-restricted-globals': ['error', { name: 'fetch', message: fetchMessage }],
        'no-restricted-properties': [
          'error',
          ...FETCH_GLOBALS.map((object) => ({ object, property: 'fetch', message: fetchMessage })),
          ...restrictedAttributeProperties,
        ],
        '@typescript-eslint/no-restricted-imports': [
          'error',
          { paths: HTTP_CLIENT_PACKAGES.map((name) => ({ name, message: clientMessage })) },
        ],
      },
    },
  ];
};
