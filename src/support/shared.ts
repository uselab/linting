import type { Linter } from 'eslint';

export type Config = Linter.Config;
export type Rules = NonNullable<Linter.Config['rules']>;

export const TS_FILES = ['**/*.{ts,mts,cts,tsx}'];
export const VUE_FILES = ['**/*.vue'];
export const JSX_FILES = ['**/*.{jsx,tsx}'];
export const TEST_FILES = ['test/**'];
export const SOURCE_FILES = ['src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}'];

/** Options every preset accepts; presets with more options extend this type. */
export type PresetOptions = {
  /**
   * Globs the preset is limited to. Presets with built-in globs apply to the files matching both;
   * the `browser`, `node` and `query` presets use these globs instead of their default scope.
   */
  files?: string[];
  /** Globs of files the preset does not apply to. */
  ignores?: string[];
};

/**
 * Applies the preset options to every config block: `files` is intersected with the block's own
 * `files` (nested arrays are AND in ESLint), and `ignores` is added to the block's own.
 */
export const scopeConfigs = (configs: Config[], options: PresetOptions): Config[] => {
  const { files, ignores } = options;
  if (files === undefined && ignores === undefined) {
    return configs;
  }
  return configs.map((config) => ({
    ...config,
    ...(files === undefined
      ? {}
      : {
          files:
            config.files === undefined
              ? files
              : config.files.flatMap((own) => files.map((file) => [...[own].flat(), file])),
        }),
    ...(ignores === undefined ? {} : { ignores: [...(config.ignores ?? []), ...ignores] }),
  }));
};

/** The `files` / `ignores` keys of a config block, left out when not set. */
export const scope = (files: string[] | undefined, ignores: string[] | undefined): Config => ({
  ...(files === undefined ? {} : { files }),
  ...(ignores === undefined ? {} : { ignores }),
});

// Root-level tooling files (eslint.config.ts, vite.config.ts, ...) that run in Node.
export const ROOT_TOOLING_FILES = ['*.{js,mjs,cjs,ts,mts,cts}'];
