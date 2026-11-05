import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addMissingAliases,
  checkAliases,
  checkImplicitAny,
  disallowImplicitAny,
  findSourceTsconfig,
  findSourceTsconfigs,
  setupNodeTsconfig,
  typecheckTarget,
} from '../../src/features/cli/tsconfig';

let dir = '';

const write = (file: string, content: string): void => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
};

const statuses = (): string[] => {
  const info = findSourceTsconfig(dir);
  if (!info) {
    throw new Error('no tsconfig');
  }
  return checkAliases(dir, info).checks.map(({ alias, status }) => `${alias}:${status}`);
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-tsconfig-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findSourceTsconfig', () => {
  it('returns undefined without a tsconfig', () => {
    expect(findSourceTsconfig(dir)).toBeUndefined();
  });

  it('uses a regular tsconfig.json', () => {
    write('tsconfig.json', '{ "include": ["src"] }');
    expect(findSourceTsconfig(dir)?.file).toBe('tsconfig.json');
  });

  it('follows a solution-style tsconfig to the config that includes src', () => {
    write(
      'tsconfig.json',
      '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.app.json" }] }',
    );
    write('tsconfig.node.json', '{ "include": ["vite.config.ts"] }');
    write('tsconfig.app.json', '{ // comment\n "include": ["src/**/*.ts",], }');
    expect(findSourceTsconfig(dir)?.file).toBe('tsconfig.app.json');
  });

  it('finds the tsconfig of each nested src folder', () => {
    write('tsconfig.json', '{ "include": ["scripts"] }');
    write('apps/web/tsconfig.json', '{ "include": ["src"] }');
    write(
      'apps/admin/tsconfig.json',
      '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.app.json" }] }',
    );
    write('apps/admin/tsconfig.node.json', '{ "include": ["vite.config.ts"] }');
    write('apps/admin/tsconfig.app.json', '{ "include": ["src"] }');
    expect(findSourceTsconfig(dir, 'apps/web/src')?.file).toBe('apps/web/tsconfig.json');
    expect(
      findSourceTsconfigs(dir, ['apps/web/src', './apps/admin/src/']).map(({ file }) => file),
    ).toEqual(['apps/web/tsconfig.json', 'apps/admin/tsconfig.app.json']);
  });

  it('checks the aliases against a nested src folder', () => {
    write(
      'apps/web/tsconfig.json',
      '{ "compilerOptions": { "paths": { "@app/*": ["./src/app/*"] } }, "include": ["src"] }',
    );
    const info = findSourceTsconfig(dir, 'apps/web/src');
    const checks = info ? checkAliases(dir, info, 'apps/web/src').checks : [];
    expect(checks.map(({ alias, status }) => `${alias}:${status}`)).toEqual([
      '@app/*:ok',
      '@features/*:missing',
      '@support/*:missing',
    ]);
  });
});

describe('checkAliases', () => {
  it('reports missing aliases', () => {
    write('tsconfig.json', '{ "include": ["src"] }');
    expect(statuses()).toEqual(['@app/*:missing', '@features/*:missing', '@support/*:missing']);
  });

  it('accepts mappings with and without ./ and relative to baseUrl', () => {
    write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: './src',
          paths: { '@app/*': ['app/*'], '@features/*': ['./features/*'], '@support/*': ['lib/*'] },
        },
      }),
    );
    expect(statuses()).toEqual(['@app/*:ok', '@features/*:ok', '@support/*:conflict']);
  });

  it('resolves paths inherited through extends and marks them not editable', () => {
    write(
      'tsconfig.base.json',
      JSON.stringify({ compilerOptions: { paths: { '@app/*': ['./src/app/*'] } } }),
    );
    write('tsconfig.json', '{ "extends": "./tsconfig.base.json", "include": ["src"] }');
    const info = findSourceTsconfig(dir);
    const report = info && checkAliases(dir, info);
    expect(report?.editable).toBe(false);
    expect(report?.checks.map(({ status }) => status)).toEqual(['ok', 'missing', 'missing']);
  });
});

describe('addMissingAliases', () => {
  it('adds the aliases without baseUrl, keeping comments and existing paths', () => {
    const text = [
      '{',
      '  // app config',
      '  "compilerOptions": {',
      '    "strict": true,',
      '    "paths": { "@app/*": ["./src/app/*"] }',
      '  },',
      '  "include": ["src"]',
      '}',
      '',
    ].join('\n');
    write('tsconfig.json', text);
    const info = findSourceTsconfig(dir);
    if (!info) {
      throw new Error('no tsconfig');
    }
    const patched = addMissingAliases(text, checkAliases(dir, info).checks);
    expect(patched).toContain('// app config');
    expect(parse(patched).compilerOptions).toEqual({
      strict: true,
      paths: {
        '@app/*': ['./src/app/*'],
        '@features/*': ['./src/features/*'],
        '@support/*': ['./src/support/*'],
      },
    });
  });

  it('maps relative to a tsconfig in a subfolder', () => {
    write('tsconfig.json', '{ "files": [], "references": [{ "path": "./config" }] }');
    write('config/tsconfig.json', '{ "include": ["../src"] }');
    const info = findSourceTsconfig(dir);
    expect(info?.file).toBe('config/tsconfig.json');
    const checks = info ? checkAliases(dir, info).checks : [];
    expect(checks.map(({ expected }) => expected)).toEqual([
      '../src/app/*',
      '../src/features/*',
      '../src/support/*',
    ]);
  });
});

describe('setupNodeTsconfig', () => {
  const written = (): Record<string, unknown> => {
    const result = setupNodeTsconfig(dir, 'vite.config.ts');
    if (result.status !== 'updated') {
      throw new Error(`status ${result.status}`);
    }
    return Object.fromEntries(result.writes.map(({ file, text }) => [file, parse(text)]));
  };

  it('moves the Vite config out of a single tsconfig into tsconfig.node.json', () => {
    write(
      'tsconfig.json',
      [
        '{',
        '  // app',
        '  "compilerOptions": { "types": ["vite/client"] },',
        '  "include": ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"]',
        '}',
        '',
      ].join('\n'),
    );
    const result = setupNodeTsconfig(dir, 'vite.config.ts');
    expect(result.status === 'updated' && result.split).toBe(true);
    const files = written();
    expect(Object.keys(files).toSorted()).toEqual(['tsconfig.json', 'tsconfig.node.json']);
    // No reference: a config with its own files can't reference a noEmit project.
    expect(files['tsconfig.json']).toEqual({
      compilerOptions: { types: ['vite/client'] },
      include: ['src/**/*.ts', 'src/**/*.vue'],
    });
    expect(files['tsconfig.node.json']).toMatchObject({
      compilerOptions: { types: ['node'] },
      include: ['vite.config.ts'],
    });
  });

  it('moves it out of the src config of a solution and references tsconfig.node.json', () => {
    write('tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }');
    write('tsconfig.app.json', '{ "include": ["src", "./vite.config.ts"] }');
    const files = written();
    expect(files['tsconfig.app.json']).toEqual({ include: ['src'] });
    expect(files['tsconfig.json']).toEqual({
      files: [],
      references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
    });
  });

  it('adds the file and "node" to an existing tsconfig.node.json', () => {
    write('tsconfig.json', '{ "include": ["src", "vite.config.ts"] }');
    write('tsconfig.node.json', '{ "compilerOptions": { "types": ["foo"] }, "include": ["x.ts"] }');
    expect(written()['tsconfig.node.json']).toEqual({
      compilerOptions: { types: ['foo', 'node'] },
      include: ['x.ts', 'vite.config.ts'],
    });
  });

  it('adds "node" to a dedicated config with explicit types, also when inherited', () => {
    write(
      'tsconfig.json',
      '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }',
    );
    write('tsconfig.app.json', '{ "include": ["src"] }');
    write('tsconfig.base.json', '{ "compilerOptions": { "types": ["vitest"] } }');
    write(
      'tsconfig.node.json',
      '{ "extends": "./tsconfig.base.json", "include": ["vite.config.ts"] }',
    );
    expect(written()).toEqual({
      'tsconfig.node.json': {
        extends: './tsconfig.base.json',
        include: ['vite.config.ts'],
        compilerOptions: { types: ['vitest', 'node'] },
      },
    });
  });

  it('sets "types": ["node"] on a dedicated config without types', () => {
    write(
      'tsconfig.json',
      '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }',
    );
    write('tsconfig.app.json', '{ "include": ["src"] }');
    write('tsconfig.node.json', '{ "include": ["vite.config.ts"] }');
    expect(written()).toEqual({
      'tsconfig.node.json': {
        include: ['vite.config.ts'],
        compilerOptions: { types: ['node'] },
      },
    });
  });

  it.each([['["node"]'], ['["*"]']])(
    'leaves configs whose types %s already load the Node types unchanged',
    (types) => {
      write(
        'tsconfig.json',
        `{ "compilerOptions": { "types": ${types} }, "include": ["vite.config.ts"] }`,
      );
      expect(setupNodeTsconfig(dir, 'vite.config.ts')).toEqual({ status: 'unchanged' });
    },
  );

  it('asks for a manual change when only a glob includes the Vite config', () => {
    write('tsconfig.json', '{ "include": ["src", "*.ts"] }');
    expect(setupNodeTsconfig(dir, 'vite.config.ts')).toEqual({
      status: 'manual',
      file: 'tsconfig.json',
    });
    write('tsconfig.json', '{ "compilerOptions": {} }');
    expect(setupNodeTsconfig(dir, 'vite.config.ts').status).toBe('manual');
  });

  it('does nothing when no tsconfig includes the Vite config', () => {
    expect(setupNodeTsconfig(dir, 'vite.config.ts')).toEqual({ status: 'unchanged' });
    write('tsconfig.json', '{ "include": ["src/**/*.ts"] }');
    expect(setupNodeTsconfig(dir, 'vite.config.ts')).toEqual({ status: 'unchanged' });
  });
});

describe('typecheckTarget', () => {
  it('returns undefined without a tsconfig', () => {
    expect(typecheckTarget(dir)).toBeUndefined();
  });

  it('uses build mode for a solution-style tsconfig', () => {
    write('tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }');
    expect(typecheckTarget(dir)).toEqual({ build: true });
  });

  it('checks the root tsconfig and a separate tsconfig.node.json', () => {
    write('tsconfig.json', '{ "include": ["src"] }');
    expect(typecheckTarget(dir)).toEqual({ build: false, projects: ['tsconfig.json'] });
    write('tsconfig.node.json', '{ "include": ["vite.config.ts"] }');
    expect(typecheckTarget(dir)).toEqual({
      build: false,
      projects: ['tsconfig.json', 'tsconfig.node.json'],
    });
  });
});

describe('checkImplicitAny', () => {
  const status = (): string => {
    const info = findSourceTsconfig(dir);
    if (!info) {
      throw new Error('no tsconfig');
    }
    return checkImplicitAny(dir, info);
  };

  it('allows implicit any by default', () => {
    write('tsconfig.json', '{ "include": ["src"] }');
    expect(status()).toBe('allowed');
  });

  it('reads noImplicitAny and strict', () => {
    write('tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    expect(status()).toBe('disallowed');
    write('tsconfig.json', '{ "compilerOptions": { "strict": true, "noImplicitAny": false } }');
    expect(status()).toBe('allowed');
    write('tsconfig.json', '{ "compilerOptions": { "noImplicitAny": true } }');
    expect(status()).toBe('disallowed');
  });

  it('merges the options through relative extends before applying strict', () => {
    write('tsconfig.base.json', '{ "compilerOptions": { "noImplicitAny": false } }');
    write(
      'tsconfig.json',
      '{ "extends": "./tsconfig.base", "compilerOptions": { "strict": true } }',
    );
    expect(status()).toBe('allowed');
    write('tsconfig.base.json', '{ "compilerOptions": { "strict": true } }');
    write('tsconfig.json', '{ "extends": "./tsconfig.base.json" }');
    expect(status()).toBe('disallowed');
  });

  it('resolves package extends, the last entry winning', () => {
    write('node_modules/@scope/tsconfig/package.json', '{ "name": "@scope/tsconfig" }');
    write('node_modules/@scope/tsconfig/strict.json', '{ "compilerOptions": { "strict": true } }');
    write('node_modules/@scope/tsconfig/loose.json', '{ "compilerOptions": { "strict": false } }');
    write(
      'tsconfig.json',
      '{ "extends": ["@scope/tsconfig/loose.json", "@scope/tsconfig/strict"] }',
    );
    expect(status()).toBe('disallowed');
  });

  it('is unknown when an extends can not be resolved', () => {
    write('tsconfig.json', '{ "extends": "@missing/tsconfig" }');
    expect(status()).toBe('unknown');
  });

  it('sets noImplicitAny, keeping comments', () => {
    const text = disallowImplicitAny(
      '{\n  // comment\n  "compilerOptions": { "strict": false }\n}\n',
    );
    expect(text).toContain('// comment');
    expect(parse(text)).toEqual({ compilerOptions: { strict: false, noImplicitAny: true } });
  });
});
