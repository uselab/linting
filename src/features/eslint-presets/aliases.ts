import { type Config } from '../../support/shared';

/**
 * Imports via the `@app` / `@features` / `@support` path aliases instead of parent-relative
 * (`../`) paths. Only for projects whose bundler resolves the aliases (e.g. Vite, Next.js, Nuxt):
 * Node and `tsc` don't, so leave it out for those.
 */
export const aliases: Config[] = [
  {
    name: 'uselab/aliases',
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '..'],
              message: 'Parent-relative imports are not allowed. Use @app, @features or @support.',
            },
          ],
        },
      ],
    },
  },
];
