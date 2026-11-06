import { describe, expect, it } from 'vitest';
import {
  addScripts,
  checkScripts,
  findStaleScripts,
  requiredScripts,
  typecheckCommand,
} from '../../src/features/cli/scripts';

describe('requiredScripts', () => {
  it('adds format scripts only with the prettier preset', () => {
    expect(Object.keys(requiredScripts(['javascript']))).toEqual([
      'lint',
      'lint:fix',
      'lint:analyze',
    ]);
    expect(Object.keys(requiredScripts(['javascript', 'prettier']))).toEqual([
      'lint',
      'lint:fix',
      'lint:analyze',
      'format',
      'format:check',
    ]);
  });

  it('adds the typecheck script when given', () => {
    expect(requiredScripts(['typescript'], 'tsc --noEmit')).toMatchObject({
      typecheck: 'tsc --noEmit',
    });
  });
});

describe('typecheckCommand', () => {
  it('uses build mode for a solution-style tsconfig', () => {
    expect(typecheckCommand({ build: true }, false)).toBe('tsc -b');
    expect(typecheckCommand({ build: true }, true)).toBe('vue-tsc -b');
  });

  it('checks each tsconfig with --noEmit', () => {
    expect(typecheckCommand({ build: false, projects: ['tsconfig.json'] }, false)).toBe(
      'tsc --noEmit',
    );
    expect(
      typecheckCommand({ build: false, projects: ['tsconfig.json', 'tsconfig.node.json'] }, true),
    ).toBe('vue-tsc --noEmit && vue-tsc --noEmit -p tsconfig.node.json');
    expect(typecheckCommand({ build: false, projects: ['tsconfig.app.json'] }, false)).toBe(
      'tsc --noEmit -p tsconfig.app.json',
    );
  });
});

describe('checkScripts', () => {
  it('reports missing, ok and conflicting scripts', () => {
    const required = { lint: 'eslint .', format: 'prettier --write .', 'lint:fix': 'x' };
    const checks = checkScripts({ lint: 'eslint .', format: 'prettier -w src' }, required);
    expect(checks.map(({ name, status }) => [name, status])).toEqual([
      ['lint', 'ok'],
      ['format', 'conflict'],
      ['lint:fix', 'missing'],
    ]);
  });
});

describe('addScripts', () => {
  const missing = checkScripts({}, { lint: 'eslint .', format: 'prettier --write .' });

  it('appends to an existing scripts object, preserving formatting', () => {
    const text = '{\n    "name": "app",\n    "scripts": {\n        "dev": "vite"\n    }\n}\n';
    const result = addScripts(text, true, missing);
    expect(JSON.parse(result).scripts).toEqual({
      dev: 'vite',
      lint: 'eslint .',
      format: 'prettier --write .',
    });
    expect(Object.keys(JSON.parse(result).scripts)).toEqual(['dev', 'lint', 'format']);
    expect(result).toContain('\n        "lint": "eslint ."');
  });

  it('creates the scripts object before the dependencies', () => {
    const text = '{\n  "name": "app",\n  "dependencies": {}\n}\n';
    const result = addScripts(text, false, missing);
    expect(Object.keys(JSON.parse(result))).toEqual(['name', 'scripts', 'dependencies']);
    expect(JSON.parse(result).scripts).toEqual({ lint: 'eslint .', format: 'prettier --write .' });
  });

  it('overwrites conflicting scripts in place', () => {
    const text = '{\n  "scripts": {\n    "lint": "biome check",\n    "dev": "vite"\n  }\n}\n';
    const checks = checkScripts({ lint: 'biome check', dev: 'vite' }, { lint: 'eslint .' });
    const result = addScripts(text, true, checks);
    expect(JSON.parse(result).scripts).toEqual({ lint: 'eslint .', dev: 'vite' });
    expect(Object.keys(JSON.parse(result).scripts)).toEqual(['lint', 'dev']);
  });
});

describe('findStaleScripts', () => {
  it('finds scripts that run removed tools, except the ignored ones', () => {
    const scripts = {
      lint: 'biome check',
      'lint:ts': 'tslint -p .',
      check: 'npm run build && xo',
      fmt: 'npx dprint fmt',
      dev: 'vite',
      'lint:css': 'stylelint "**/*.css"',
      test: 'vitest --standard-mode',
    };
    expect(findStaleScripts(scripts, ['lint'])).toEqual(['lint:ts', 'check', 'fmt']);
  });
});
