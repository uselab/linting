import { describe, expect, it } from 'vitest';
import {
  checkDependencies,
  installCommand,
  minimumOfRange,
  nodeTypesRange,
  patchPackageJson,
  requiredDependencies,
  setModuleType,
} from '../../src/features/cli/dependencies';

describe('requiredDependencies', () => {
  it('always needs the package, eslint and jiti (for eslint.config.mts)', () => {
    expect(requiredDependencies(['javascript'], '1.2.3').map(({ name }) => name)).toEqual([
      '@uselab/linting',
      'eslint',
      'jiti',
    ]);
  });

  it('adds prettier and typescript when those presets are chosen', () => {
    const names = requiredDependencies(['typescript', 'prettier'], '1.0.0').map(({ name }) => name);
    expect(names).toEqual(['@uselab/linting', 'eslint', 'jiti', 'prettier', 'typescript']);
  });

  it('adds @types/node with the given range, accepting any declared version', () => {
    const requirements = requiredDependencies(['javascript'], '1.0.0', { nodeTypes: '^22' });
    expect(requirements.at(-1)).toMatchObject({ name: '@types/node', range: '^22' });
    const checks = checkDependencies(
      { devDependencies: { '@types/node': 'latest' } },
      requirements,
    );
    expect(checks.at(-1)?.status).toBe('ok');
    expect(checkDependencies({}, requirements).at(-1)?.status).toBe('missing');
  });

  it('adds vue-tsc for vue + typescript and vite-plugin-checker when requested', () => {
    const names = (presets: Parameters<typeof requiredDependencies>[0], viteChecker = false) =>
      requiredDependencies(presets, '1.0.0', { viteChecker }).map(({ name }) => name);
    expect(names(['typescript', 'vue'], true).slice(3)).toEqual([
      'typescript',
      'vue-tsc',
      'vite-plugin-checker',
    ]);
    expect(names(['javascript', 'vue'])).not.toContain('vue-tsc');
  });
});

describe('nodeTypesRange', () => {
  it.each([
    [{ engines: { node: '>=22.18' } }, '^22'],
    [{ engines: { node: '^20.11.0 || >=22' } }, '^24'],
    [{ engines: { node: '20.x' } }, '^20'],
    [{}, '^24'],
    [undefined, '^24'],
  ])('maps %j to %s', (packageJson, expected) => {
    expect(nodeTypesRange(packageJson)).toBe(expected);
  });
});

describe('minimumOfRange', () => {
  it.each([
    ['^10.4.0', [10, 4, 0]],
    ['~2.2', [2, 2, 0]],
    ['>=5.0.0 <6.1.0', [5, 0, 0]],
    ['3.1.2', [3, 1, 2]],
    ['v2.x', [2, 0, 0]],
  ])('parses %s', (range, expected) => {
    expect(minimumOfRange(range)).toEqual(expected);
  });

  it.each(['latest', '*', 'workspace:*', 'npm:eslint@10', 'github:org/repo', '^9 || ^10'])(
    'returns undefined for %s',
    (range) => {
      expect(minimumOfRange(range)).toBeUndefined();
    },
  );
});

describe('checkDependencies', () => {
  const requirements = requiredDependencies(['prettier'], '1.0.0');

  it('reports missing, outdated, unverifiable and ok dependencies', () => {
    const checks = checkDependencies(
      {
        dependencies: { prettier: 'latest' },
        devDependencies: { eslint: '^9.30.0', jiti: '^2.4.0', '@uselab/linting': '^1.0.0' },
      },
      requirements,
    );
    expect(checks.map(({ name, status, field }) => [name, status, field])).toEqual([
      ['@uselab/linting', 'ok', 'devDependencies'],
      ['eslint', 'outdated', 'devDependencies'],
      ['jiti', 'ok', 'devDependencies'],
      ['prettier', 'unverifiable', 'dependencies'],
    ]);
  });

  it('flags an empty package.json as missing everything', () => {
    expect(checkDependencies({}, requirements).every(({ status }) => status === 'missing')).toBe(
      true,
    );
  });
});

describe('patchPackageJson', () => {
  it('adds missing and updates outdated entries, keeping formatting and sorting', () => {
    const text = [
      '{',
      '    "name": "app",',
      '    "dependencies": {',
      '        "eslint": "^9.0.0"',
      '    },',
      '    "devDependencies": {',
      '        "aaa": "1.0.0",',
      '        "zzz": "1.0.0"',
      '    }',
      '}',
      '',
    ].join('\n');
    const checks = checkDependencies(JSON.parse(text), requiredDependencies([], '1.0.0'));
    const patched = patchPackageJson(text, checks);
    expect(patched).toBe(
      [
        '{',
        '    "name": "app",',
        '    "dependencies": {',
        '        "eslint": "^10.4.0"',
        '    },',
        '    "devDependencies": {',
        '        "@uselab/linting": "^1.0.0",',
        '        "aaa": "1.0.0",',
        '        "jiti": "^2.2.0",',
        '        "zzz": "1.0.0"',
        '    }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('creates devDependencies when missing', () => {
    const text = '{\n  "name": "app"\n}\n';
    const patched = patchPackageJson(
      text,
      checkDependencies(JSON.parse(text), requiredDependencies([], '1.0.0')),
    );
    expect(JSON.parse(patched)).toEqual({
      name: 'app',
      devDependencies: { '@uselab/linting': '^1.0.0', eslint: '^10.4.0', jiti: '^2.2.0' },
    });
    expect(patched.endsWith('}\n')).toBe(true);
  });
});

describe('setModuleType', () => {
  it('adds "type" after name/version, keeping formatting', () => {
    const text = '{\n    "name": "app",\n    "version": "1.0.0",\n    "scripts": {}\n}\n';
    expect(setModuleType(text)).toBe(
      '{\n    "name": "app",\n    "version": "1.0.0",\n    "type": "module",\n    "scripts": {}\n}\n',
    );
  });

  it('replaces an existing "type": "commonjs"', () => {
    expect(JSON.parse(setModuleType('{ "type": "commonjs", "name": "app" }'))).toEqual({
      type: 'module',
      name: 'app',
    });
  });

  it('adds "type" first when there are no name-like keys', () => {
    expect(Object.keys(JSON.parse(setModuleType('{ "scripts": {} }')))).toEqual([
      'type',
      'scripts',
    ]);
  });
});

describe('installCommand', () => {
  it('quotes ranges with spaces', () => {
    expect(installCommand(requiredDependencies(['typescript'], '1.0.0'))).toBe(
      'npm install -D @uselab/linting@^1.0.0 eslint@^10.4.0 jiti@^2.2.0 "typescript@>=5.0.0 <6.1.0"',
    );
  });
});
