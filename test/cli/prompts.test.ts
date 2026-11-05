import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { splitGlobs, validateSrcDirs, validateTsconfigs } from '../../src/features/cli/prompts';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-prompts-'));
  mkdirSync(path.join(dir, 'src'));
  mkdirSync(path.join(dir, 'packages', 'web', 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'tsconfig.app.json'), '{}');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('validateSrcDirs', () => {
  it('accepts existing folders', () => {
    expect(validateSrcDirs(dir, 'src, packages/web/src')).toBeUndefined();
  });

  it('requires at least one folder', () => {
    expect(validateSrcDirs(dir, ' , ')).toBe('Enter at least one folder.');
    expect(validateSrcDirs(dir, undefined)).toBe('Enter at least one folder.');
  });

  it('rejects missing folders and files', () => {
    expect(validateSrcDirs(dir, 'src, scr, tsconfig.app.json')).toBe(
      'Folder(s) not found in the project: scr, tsconfig.app.json',
    );
  });
});

describe('validateTsconfigs', () => {
  it('accepts empty input (auto-detect) and existing files', () => {
    expect(validateTsconfigs(dir, '')).toBeUndefined();
    expect(validateTsconfigs(dir, 'tsconfig.app.json')).toBeUndefined();
  });

  it('rejects missing files and folders', () => {
    expect(validateTsconfigs(dir, 'tsconfig.app.json, tsconfig.web.json, src')).toBe(
      'File(s) not found in the project: tsconfig.web.json, src',
    );
  });
});

describe('splitGlobs', () => {
  it('splits on commas outside braces and trims', () => {
    expect(splitGlobs(' **/*.{test,spec}.{js,ts}, e2e/** ,, tests/{a,{b,c}}/*.ts ')).toEqual([
      '**/*.{test,spec}.{js,ts}',
      'e2e/**',
      'tests/{a,{b,c}}/*.ts',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(splitGlobs(' , ')).toEqual([]);
  });
});
