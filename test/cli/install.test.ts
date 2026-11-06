import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Requirement } from '../../src/features/cli/dependencies';
import { isInstalledOutdated, missingInstalls } from '../../src/features/cli/install';

let dir = '';

const install = (name: string, version: string): void => {
  mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
  writeFileSync(
    path.join(dir, 'node_modules', name, 'package.json'),
    JSON.stringify({ name, version }),
  );
};

const requirement = (name: string, minVersion: string): Requirement => ({
  name,
  minVersion,
  range: `^${minVersion}`,
  reason: 'test',
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-install-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('missingInstalls', () => {
  it('returns the requirements that are not installed or too old', () => {
    install('eslint', '10.5.0');
    install('jiti', '2.1.0');
    install('@types/node', '20.0.0');

    const missing = missingInstalls(dir, [
      requirement('eslint', '10.4.0'),
      requirement('jiti', '2.2.0'),
      requirement('prettier', '3.5.0'),
      requirement('@types/node', '0.0.0'),
    ]);

    expect(missing.map(({ name }) => name)).toEqual(['jiti', 'prettier']);
  });

  it('returns all requirements without node_modules', () => {
    expect(missingInstalls(dir, [requirement('eslint', '10.4.0')])).toHaveLength(1);
  });
});

describe('isInstalledOutdated', () => {
  it('is false for a missing package', () => {
    expect(isInstalledOutdated(dir, requirement('eslint', '10.4.0'))).toBe(false);
  });

  it('compares the installed version with the minimum', () => {
    install('eslint', '10.3.9');
    expect(isInstalledOutdated(dir, requirement('eslint', '10.4.0'))).toBe(true);
    expect(isInstalledOutdated(dir, requirement('eslint', '10.3.0'))).toBe(false);
  });
});
