import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';

type CompilerOptions = {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  types?: string[];
  strict?: boolean;
  noImplicitAny?: boolean;
};

export type RawTsconfig = {
  extends?: string | string[];
  compilerOptions?: CompilerOptions;
  include?: string[];
  files?: string[];
  references?: { path: string }[];
};

export type TsconfigInfo = {
  /** Path relative to the project, with forward slashes (e.g. `tsconfig.app.json`). */
  file: string;
  absolutePath: string;
  text: string;
  config: RawTsconfig;
};

export const DEFAULT_SRC_DIRS = ['src'];

export const toPosix = (value: string): string => value.replaceAll('\\', '/');

/** Normalizes a src dir to a project-relative posix path without `./` or a trailing slash. */
export const normalizeSrcDir = (srcDir: string): string =>
  toPosix(srcDir)
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');

export const NESTED_SRC_DIRS_MESSAGE = 'Boundaries cannot be nested';

/** Whether one src dir lies inside another (after normalizing). */
export const hasNestedSrcDirs = (srcDirs: string[]): boolean => {
  const normalized = srcDirs.map(normalizeSrcDir);
  return normalized.some((srcDir) =>
    normalized.some((other) => srcDir !== other && srcDir.startsWith(`${other}/`)),
  );
};

export const readTsconfig = (
  projectDir: string,
  absolutePath: string,
): TsconfigInfo | undefined => {
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  const text = readFileSync(absolutePath, 'utf8');
  const config: RawTsconfig = parse(text, [], { allowTrailingComma: true }) ?? {};
  return { file: toPosix(path.relative(projectDir, absolutePath)), absolutePath, text, config };
};

export const referencePath = (configDir: string, reference: string): string => {
  const resolved = path.resolve(configDir, reference);
  return reference.endsWith('.json') ? resolved : path.join(resolved, 'tsconfig.json');
};

export const isSolution = (config: RawTsconfig): boolean =>
  Array.isArray(config.references) &&
  (config.files?.length === 0 || (config.files === undefined && config.include === undefined));

const isWithinOrSame = (dir: string, target: string): boolean =>
  target === dir || target.startsWith(`${dir}${path.sep}`);

/** Whether the tsconfig's `include` covers the directory (an entry is the dir or lies in it). */
export const coversDir = (info: TsconfigInfo, dir: string): boolean => {
  const configDir = path.dirname(info.absolutePath);
  return (info.config.include ?? []).some((entry) =>
    isWithinOrSame(dir, path.resolve(configDir, entry)),
  );
};

/** Whether a non-solution tsconfig without `include` / `files` (TypeScript: `**\/*`) contains the dir. */
const coversByDefault = (info: TsconfigInfo, dir: string): boolean =>
  info.config.include === undefined &&
  info.config.files === undefined &&
  !isSolution(info.config) &&
  isWithinOrSame(path.dirname(info.absolutePath), dir);

const ROOT_NAMES = ['tsconfig.json', 'tsconfig.app.json'];

const rootIn = (projectDir: string, dir: string): TsconfigInfo | undefined =>
  ROOT_NAMES.map((name) => readTsconfig(projectDir, path.join(dir, name))).find(
    (info) => info !== undefined,
  );

const referencedConfigs = (projectDir: string, root: TsconfigInfo): TsconfigInfo[] =>
  (root.config.references ?? [])
    .map((reference) =>
      readTsconfig(projectDir, referencePath(path.dirname(root.absolutePath), reference.path)),
    )
    .filter((info): info is TsconfigInfo => info !== undefined);

/** The tsconfig of a root (or one of its references) that covers the src dir. */
const coveringConfig = (
  projectDir: string,
  root: TsconfigInfo,
  dir: string,
): TsconfigInfo | undefined =>
  [root, ...referencedConfigs(projectDir, root)].find(
    (info) => !isSolution(info.config) && (coversDir(info, dir) || coversByDefault(info, dir)),
  );

/** Directories from the parent of the src dir up to the project dir (nearest first). */
const ancestors = (projectDir: string, dir: string): string[] => {
  const result: string[] = [];
  for (let current = path.dirname(dir); isWithinOrSame(projectDir, current);) {
    result.push(current);
    if (current === projectDir) {
      break;
    }
    current = path.dirname(current);
  }
  return result.length > 0 ? result : [projectDir];
};

/**
 * Finds the tsconfig that covers a src dir (default `src`). Looks for `tsconfig.json` /
 * `tsconfig.app.json` from the parent of the src dir up to the project; solution-style configs
 * (`files: []` + `references`, as in Vite templates) are followed to the referenced config that
 * includes the src dir (e.g. `tsconfig.app.json`, not `tsconfig.node.json`). Falls back to the
 * nearest root config (or its first reference).
 */
export const findSourceTsconfig = (
  projectDir: string,
  srcDir = 'src',
): TsconfigInfo | undefined => {
  const dir = path.resolve(projectDir, srcDir);
  const roots = ancestors(projectDir, dir)
    .map((candidate) => rootIn(projectDir, candidate))
    .filter((info): info is TsconfigInfo => info !== undefined);
  for (const root of roots) {
    const covering = coveringConfig(projectDir, root, dir);
    if (covering) {
      return covering;
    }
  }
  const [nearest] = roots;
  if (!nearest || !isSolution(nearest.config)) {
    return nearest;
  }
  return referencedConfigs(projectDir, nearest)[0] ?? nearest;
};

/** The tsconfigs covering the src dirs, without duplicates, in src dir order. */
export const findSourceTsconfigs = (projectDir: string, srcDirs: string[]): TsconfigInfo[] => {
  const found = srcDirs
    .map((srcDir) => findSourceTsconfig(projectDir, srcDir))
    .filter((info): info is TsconfigInfo => info !== undefined);
  return found.filter(
    (info, index) => found.findIndex((other) => other.absolutePath === info.absolutePath) === index,
  );
};
