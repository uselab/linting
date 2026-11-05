/**
 * Default global ignores, written by `init` into `globalIgnores([...])` (from `eslint/config`)
 * after the lint scope patterns, so a negation such as `!src/**` doesn't un-ignore `src/dist`.
 */
export const DEFAULT_IGNORES: readonly string[] = [
  '**/dist/**',
  '**/node_modules/**',
  '**/coverage/**',
  '**/*.tsbuildinfo',
];
