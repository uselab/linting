import type { Linter } from 'eslint';

export type Config = Linter.Config;
export type Rules = NonNullable<Linter.Config['rules']>;

export const TS_FILES = ['**/*.{ts,mts,cts,tsx}'];
export const VUE_FILES = ['**/*.vue'];
export const JSX_FILES = ['**/*.{jsx,tsx}'];
export const TEST_FILES = ['test/**'];
export const SOURCE_FILES = ['src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}'];

/** The `files` / `ignores` keys of a config block, left out when not set. */
export const scope = (files: string[] | undefined, ignores: string[] | undefined): Config => ({
  ...(files === undefined ? {} : { files }),
  ...(ignores === undefined ? {} : { ignores }),
});

// Root-level tooling files (eslint.config.ts, vite.config.ts, ...) that run in Node.
export const ROOT_TOOLING_FILES = ['*.{js,mjs,cjs,ts,mts,cts}'];
