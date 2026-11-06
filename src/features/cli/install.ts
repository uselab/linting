import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { compareVersions, minimumOfRange, type Requirement } from './dependencies';

/** Installed version of a package in the project's node_modules, if any. */
const installedVersion = (projectDir: string, name: string): string | undefined => {
  const file = path.join(projectDir, 'node_modules', name, 'package.json');
  if (!existsSync(file)) {
    return undefined;
  }
  const data: { version?: string } = JSON.parse(readFileSync(file, 'utf8'));
  return data.version;
};

/** Whether the installed package is older than the minimum version. */
export const isInstalledOutdated = (
  projectDir: string,
  requirement: Pick<Requirement, 'name' | 'minVersion'>,
): boolean => {
  const version = installedVersion(projectDir, requirement.name);
  const installed = version === undefined ? undefined : minimumOfRange(version);
  const required = minimumOfRange(requirement.minVersion);
  return Boolean(installed && required && compareVersions(installed, required) < 0);
};

/** The requirements that are missing from node_modules or installed in a too old version. */
export const missingInstalls = (projectDir: string, requirements: Requirement[]): Requirement[] =>
  requirements.filter(
    (requirement) =>
      installedVersion(projectDir, requirement.name) === undefined ||
      isInstalledOutdated(projectDir, requirement),
  );

/** Runs an install command (e.g. `npm install`) in the project. Returns whether it succeeded. */
export const runInstall = (projectDir: string, command: string): boolean => {
  const result = spawnSync(command, {
    cwd: projectDir,
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
};
