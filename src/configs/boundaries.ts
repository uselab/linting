import { createRequire } from 'node:module';
import boundariesPlugin from 'eslint-plugin-boundaries';
import { SOURCE_FILES, type Config } from '../shared';

// Absolute path so the resolver is found even when it isn't hoisted into the consumer's node_modules.
const typescriptResolverPath = createRequire(import.meta.url).resolve(
  'eslint-import-resolver-typescript',
);

export type BoundaryElement = {
  type: string;
  pattern: string | string[];
  capture?: string[];
  mode?: 'file' | 'folder' | 'full';
};

export type BoundaryPolicy = Record<string, unknown> & { message?: string };

export type BoundariesOptions = {
  /** Files the boundaries rules apply to. Default: all source files under src/. */
  files?: string[];
  /** Architectural elements. Default: app (src/app), feature (src/features/*), support (src/support). */
  elements?: BoundaryElement[];
  /** Dependency policies (eslint-plugin-boundaries v7 syntax). Default: Uselab app/features/support policies. */
  policies?: BoundaryPolicy[];
  /** Globs of files that boundaries should classify. Default: ['src/**']. */
  include?: string[];
  /** tsconfig(s) used to resolve imports (e.g. path aliases). Default: auto-detect. */
  tsconfig?: string | string[];
  /** Project root that element patterns are relative to. Default: process.cwd(). Useful in monorepos. */
  rootPath?: string;
};

export const defaultBoundaryElements: BoundaryElement[] = [
  { type: 'app', pattern: 'src/app/**' },
  { type: 'feature', pattern: 'src/features/*', capture: ['featureName'] },
  { type: 'support', pattern: 'src/support/**' },
];

const disallow = (from: string, to: string, message: string): BoundaryPolicy => ({
  from: { element: { type: from } },
  disallow: { to: { element: { type: to } } },
  message,
});

export const defaultBoundaryPolicies: BoundaryPolicy[] = [
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
    'support/ must not import from features/. Move shared code to support/ instead.',
  ),
  disallow('support', 'app', 'support/ must not import from app/. Keep support isolated.'),
];

/**
 * Opt-in architecture boundaries preset (eslint-plugin-boundaries).
 * Defaults to the Uselab app / features / support layout; everything is overridable.
 */
export const boundaries = (options: BoundariesOptions = {}): Config[] => [
  {
    name: 'uselab/boundaries',
    files: options.files ?? SOURCE_FILES,
    plugins: { boundaries: boundariesPlugin },
    settings: {
      'import/resolver': {
        [typescriptResolverPath]: options.tsconfig
          ? { project: options.tsconfig, alwaysTryTypes: true }
          : { alwaysTryTypes: true },
      },
      'boundaries/elements': options.elements ?? defaultBoundaryElements,
      'boundaries/include': options.include ?? ['src/**'],
      ...(options.rootPath ? { 'boundaries/root-path': options.rootPath } : {}),
    },
    rules: {
      'import-x/no-relative-parent-imports': 'off',
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: options.policies ?? defaultBoundaryPolicies,
        },
      ],
    },
  },
];
