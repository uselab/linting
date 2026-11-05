import type { PresetId } from './generate';
import { applyJsonChanges } from './json-edit';

export type Requirement = {
  name: string;
  /** Minimum version (x.y.z) the declared range must allow as its lower bound. */
  minVersion: string;
  /** Range written to package.json when the dependency is added or updated. */
  range: string;
  reason: string;
};

export type DependencyStatus = 'ok' | 'missing' | 'outdated' | 'unverifiable';

export type DependencyCheck = Requirement & {
  status: DependencyStatus;
  declared?: string;
  field: 'dependencies' | 'devDependencies';
};

export type PackageJson = {
  type?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type DependencyOptions = {
  /** Range for `@types/node`, added when the Vite config imports Node builtins. */
  nodeTypes?: string;
  /** Whether vite-plugin-checker is used in the Vite config. */
  viteChecker?: boolean;
};

const DEFAULT_NODE_TYPES_MAJOR = 24;

export const isModulePackage = (packageJson: PackageJson | undefined): boolean =>
  packageJson?.type === 'module';

/** Sets `"type": "module"`, next to name/version/private/description when it is new. */
export const setModuleType = (text: string): string =>
  applyJsonChanges(text, [
    { path: ['type'], value: 'module', insertAfter: ['name', 'version', 'private', 'description'] },
  ]);

/** Packages the generated config needs. A TypeScript ESLint config needs ESLint's TS support + jiti. */
export const requiredDependencies = (
  presets: readonly PresetId[],
  ownVersion: string,
  options: DependencyOptions = {},
): Requirement[] => {
  const requirements: Requirement[] = [
    {
      name: '@uselab/linting',
      minVersion: ownVersion,
      range: `^${ownVersion}`,
      reason: 'the presets',
    },
    { name: 'eslint', minVersion: '10.4.0', range: '^10.4.0', reason: 'peer dependency' },
    {
      name: 'jiti',
      minVersion: '2.2.0',
      range: '^2.2.0',
      reason: 'loads the TypeScript ESLint config',
    },
  ];
  if (presets.includes('prettier')) {
    requirements.push({
      name: 'prettier',
      minVersion: '3.5.0',
      range: '^3.5.0',
      reason: 'prettier preset (TypeScript config)',
    });
  }
  if (presets.includes('typescript')) {
    requirements.push({
      name: 'typescript',
      minVersion: '5.0.0',
      range: '>=5.0.0 <6.1.0',
      reason: 'typescript preset',
    });
    if (presets.includes('vue')) {
      requirements.push({
        name: 'vue-tsc',
        minVersion: '3.0.0',
        range: '^3.0.0',
        reason: 'type-checks .vue files',
      });
    }
  }
  if (options.viteChecker) {
    requirements.push({
      name: 'vite-plugin-checker',
      minVersion: '0.14.0',
      range: '^0.14.0',
      reason: 'types and lint errors in the Vite dev server',
    });
  }
  if (options.nodeTypes) {
    // Any declared version is accepted; only a missing @types/node is added.
    requirements.push({
      name: '@types/node',
      minVersion: '0.0.0',
      range: options.nodeTypes,
      reason: 'Node types for the Vite config',
    });
  }
  return requirements;
};

type Version = [number, number, number];

const toVersion = (text: string): Version | undefined => {
  const match = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(text);
  if (!match) {
    return undefined;
  }
  const part = (value: string | undefined): number => Number.parseInt(value ?? '0', 10) || 0;
  return [part(match[1]), part(match[2]), part(match[3])];
};

/**
 * Lower bound of a simple semver range (`^1.2.3`, `~1.2`, `>=1.2.3 <2`, `1.2.3`, `1.x`).
 * Returns undefined for ranges that can't be verified (`latest`, `*`, `workspace:*`, URLs, `||`).
 */
export const minimumOfRange = (range: string): Version | undefined => {
  const trimmed = range.trim();
  if (trimmed.includes('||') || trimmed.includes(':') || trimmed.includes('/')) {
    return undefined;
  }
  const first = trimmed.split(/\s+/)[0] ?? '';
  return toVersion(first.replace(/^(?:\^|~|>=|=|v)+/, '').replace(/^v/, ''));
};

export const compareVersions = (left: Version, right: Version): number =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

/** `@types/node` range matching the major of `engines.node` (e.g. `>=22.18` → `^22`), else `^24`. */
export const nodeTypesRange = (packageJson: PackageJson | undefined): string => {
  const engine = packageJson?.engines?.node;
  const major = engine === undefined ? undefined : minimumOfRange(engine)?.[0];
  return `^${major || DEFAULT_NODE_TYPES_MAJOR}`;
};

const statusOf = (declared: string | undefined, minVersion: string): DependencyStatus => {
  if (declared === undefined) {
    return 'missing';
  }
  if (minVersion === '0.0.0') {
    return 'ok';
  }
  const minimum = minimumOfRange(declared);
  const required = toVersion(minVersion);
  if (!minimum || !required) {
    return 'unverifiable';
  }
  return compareVersions(minimum, required) < 0 ? 'outdated' : 'ok';
};

/** Checks the declared dependencies of a package.json against the requirements. */
export const checkDependencies = (
  packageJson: PackageJson,
  requirements: Requirement[],
): DependencyCheck[] =>
  requirements.map((requirement) => {
    const inDependencies = packageJson.dependencies?.[requirement.name];
    const declared = inDependencies ?? packageJson.devDependencies?.[requirement.name];
    return {
      ...requirement,
      declared,
      field: inDependencies === undefined ? 'devDependencies' : 'dependencies',
      status: statusOf(declared, requirement.minVersion),
    };
  });

export const needsUpdate = (check: DependencyCheck): boolean =>
  check.status === 'missing' || check.status === 'outdated';

/** Adds missing and updates outdated dependencies, preserving formatting. */
export const patchPackageJson = (text: string, checks: DependencyCheck[]): string =>
  applyJsonChanges(
    text,
    checks.filter(needsUpdate).map((check) => ({
      path: [check.field, check.name],
      value: check.range,
    })),
  );

const quoteArg = (value: string): string => (/[\s<>]/.test(value) ? `"${value}"` : value);

/** `npm install -D` command for the given requirements. */
export const installCommand = (requirements: Requirement[]): string =>
  `npm install -D ${requirements.map(({ name, range }) => quoteArg(`${name}@${range}`)).join(' ')}`;
