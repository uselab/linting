import { createRequire } from 'node:module';
import boundariesPlugin from 'eslint-plugin-boundaries';
import { layoutPlugin, OUTSIDE_IMPORT_MESSAGE } from '../../support/eslint-plugins/layout';
import { type Config } from '../../support/shared';
import {
  DEFAULT_SRC_DIRS,
  findSourceTsconfigs,
  normalizeSrcDir,
} from '../../support/source-tsconfig';

// Absolute path so the resolver is found even when it isn't hoisted into the consumer's node_modules.
const typescriptResolverPath = createRequire(import.meta.url).resolve(
  'eslint-import-resolver-typescript',
);

const SOURCE_EXTENSIONS = '{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}';

export type BoundariesOptions = {
  /**
   * Source folders, relative to the directory ESLint runs in, that each contain the fixed
   * `app/`, `features/*` and `support/` layout. Default: `['src']`.
   */
  srcDirs?: string[];
  /**
   * tsconfig(s) used to resolve imports (e.g. the `@app` / `@features` / `@support` aliases).
   * Default: for each src dir, the tsconfig that includes it (e.g. `tsconfig.app.json`).
   */
  tsconfig?: string | string[];
};

const escapeGlob = (value: string): string =>
  value.replaceAll(/[*?!+@|()[\]{}\\]/g, String.raw`\$&`);

type Element = { type: string; pattern: string; capture: string[]; partialMatch: false };

/**
 * The fixed layout of every src dir. `(a|b)` captures the src dir, so elements of different src
 * dirs differ; `partialMatch: false` matches from the project root, so `src` doesn't also match
 * a nested `packages/web/src`. The first matching element wins, so `outside` gets the remaining
 * files of a src dir (e.g. `src/main.css` or `src/router/`).
 */
const elementsFor = (srcDirs: string[]): Element[] => {
  const src = `(${srcDirs.map(escapeGlob).join('|')})`;
  const element = (type: string, pattern: string, capture: string[] = []): Element => ({
    type,
    pattern,
    capture: ['srcDir', ...capture],
    partialMatch: false,
  });
  return [
    element('app', `${src}/app`),
    element('feature', `${src}/features/*`, ['featureName']),
    element('support', `${src}/support`),
    element('outside', `${src}/**`),
  ];
};

const LAYOUT_TYPES = ['app', 'feature', 'support'];

const SAME_SRC_DIR = { srcDir: '{{ from.element.captured.srcDir }}' };

const disallow = (
  from: string | string[],
  to: string,
  message: string,
): Record<string, unknown> => ({
  from: { element: { type: from } },
  disallow: { to: { element: { type: to, captured: SAME_SRC_DIR } } },
  message,
});

/** Last matching policy wins; anything no policy disallows is allowed. */
const policiesFor = (srcDirs: string[]): Record<string, unknown>[] => [
  ...(srcDirs.length > 1
    ? [
        {
          from: { element: { type: '*' } },
          disallow: { to: { element: { type: '*' } } },
          message: 'Imports between src folders are not allowed. Each src folder is isolated.',
        },
        {
          from: { element: { type: '*' } },
          allow: { to: { element: { type: '*', captured: SAME_SRC_DIR } } },
        },
      ]
    : []),
  disallow(
    'feature',
    'feature',
    'Cross-feature imports are not allowed. Move shared code to support/ instead.',
  ),
  disallow(
    'feature',
    'app',
    'features/ must not import from app/. Move shared code to support/ instead.',
  ),
  disallow(
    'support',
    'feature',
    'support/ must not import from features/. Move the imported code into support/, or move the importing code into the feature or app/.',
  ),
  disallow('support', 'app', 'support/ must not import from app/. Keep support isolated.'),
  disallow(LAYOUT_TYPES, 'outside', OUTSIDE_IMPORT_MESSAGE),
];

const resolverOptions = (srcDirs: string[], tsconfig: string | string[] | undefined): object => {
  const project =
    tsconfig ?? findSourceTsconfigs(process.cwd(), srcDirs).map((info) => info.absolutePath);
  return project.length > 0 ? { project, alwaysTryTypes: true } : { alwaysTryTypes: true };
};

/** Source files of a src dir must be in app/, features/ or support/; only `.d.ts` files may not. */
const fileLocationConfig = (srcDir: string): Config => {
  const src = escapeGlob(srcDir);
  return {
    name: `uselab/boundaries/file-location/${srcDir}`,
    files: [`${src}/**/*.${SOURCE_EXTENSIONS}`],
    ignores: [`${src}/{app,features,support}/**`, '**/*.d.{ts,mts,cts}'],
    plugins: { 'uselab-layout': layoutPlugin },
    rules: { 'uselab-layout/file-location': ['error', { srcDir }] },
  };
};

/**
 * Path-style imports (`/src/main.css`, `src/main.css`) that the resolver can't follow, so
 * `boundaries/dependencies` doesn't see them; checked by their text instead.
 */
const importLocationConfig = (srcDir: string): Config => {
  const src = escapeGlob(srcDir);
  return {
    name: `uselab/boundaries/import-location/${srcDir}`,
    files: [`${src}/{app,features,support}/**/*.${SOURCE_EXTENSIONS}`],
    plugins: { 'uselab-layout': layoutPlugin },
    rules: { 'uselab-layout/import-location': ['error', { srcDir }] },
  };
};

/**
 * Opt-in project structure preset, guided by the principles of Domain-Driven Design
 * (eslint-plugin-boundaries). Enforces the fixed Uselab app / features / support layout inside
 * each src dir and keeps src dirs isolated.
 */
export const boundaries = (options: BoundariesOptions = {}): Config[] => {
  const srcDirs = (options.srcDirs ?? DEFAULT_SRC_DIRS).map(normalizeSrcDir);
  return [
    {
      name: 'uselab/boundaries',
      files: srcDirs.map((srcDir) => `${escapeGlob(srcDir)}/**/*.${SOURCE_EXTENSIONS}`),
      plugins: { boundaries: boundariesPlugin },
      settings: {
        'import/resolver': {
          [typescriptResolverPath]: resolverOptions(srcDirs, options.tsconfig),
        },
        'boundaries/elements': elementsFor(srcDirs),
        'boundaries/include': srcDirs.map((srcDir) => `${escapeGlob(srcDir)}/**`),
      },
      rules: {
        'boundaries/dependencies': ['error', { default: 'allow', policies: policiesFor(srcDirs) }],
      },
    },
    ...srcDirs.map(fileLocationConfig),
    ...srcDirs.map(importLocationConfig),
  ];
};
