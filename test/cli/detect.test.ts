import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectBrowserFiles,
  detectPresets,
  detectSrcDirs,
  detectTestFiles,
  excludeTestSrcDirs,
} from '../../src/features/cli/detect';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-detect-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectPresets', () => {
  it('always selects javascript and boundaries, aliases only for a bundler', () => {
    const { presets, projectType } = detectPresets(dir, undefined, undefined);
    expect(presets).toEqual(['javascript', 'boundaries']);
    expect(projectType).toBe('node');
  });

  it('selects prettier when a file Prettier can format exists', () => {
    mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(path.join(dir, '.git'));
    mkdirSync(path.join(dir, 'docs', 'guide'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), '');
    writeFileSync(path.join(dir, '.git', 'config.yml'), '');
    writeFileSync(path.join(dir, 'LICENSE'), '');
    writeFileSync(path.join(dir, 'docs', 'logo.png'), '');
    expect(detectPresets(dir, undefined, undefined).reasons.prettier).toBeUndefined();

    writeFileSync(path.join(dir, 'docs', 'guide', 'Intro.MD'), '');
    expect(detectPresets(dir, undefined, undefined).reasons.prettier).toContain('.md');
    writeFileSync(path.join(dir, 'package.json'), '{}');
    expect(detectPresets(dir, undefined, undefined).reasons.prettier).toContain('.json');
    writeFileSync(path.join(dir, 'docs', 'guide', 'App.vue'), '');
    writeFileSync(path.join(dir, 'vite.config.js'), '');
    expect(detectPresets(dir, undefined, undefined).reasons.prettier).toMatch(/\.js\b/);
    writeFileSync(path.join(dir, 'docs', 'guide', 'main.ts'), '');
    expect(detectPresets(dir, undefined, undefined).reasons.prettier).toContain('.ts');
  });

  it('detects a Vue + TypeScript app', () => {
    writeFileSync(path.join(dir, 'package.json'), '{}');
    const detection = detectPresets(
      dir,
      { dependencies: { vue: '^3.5.0' }, devDependencies: { vite: '^7.0.0' } },
      'tsconfig.app.json',
    );
    expect(detection.presets).toEqual([
      'javascript',
      'typescript',
      'vue',
      'query',
      'aliases',
      'boundaries',
      'prettier',
    ]);
    expect(detection.reasons.typescript).toContain('tsconfig.app.json');
    expect(detection.reasons.aliases).toContain('vite');
    expect(detection.projectType).toBe('browser');
    expect(detection.projectTypeReason).toContain('vue');
  });

  it('detects React through next', () => {
    const { presets, projectType } = detectPresets(
      dir,
      { dependencies: { next: '^15.0.0' } },
      undefined,
    );
    expect(presets).toEqual(['javascript', 'react', 'query', 'aliases', 'boundaries']);
    expect(projectType).toBe('browser');
  });

  it('detects a browser project from index.html', () => {
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    const { projectType, projectTypeReason } = detectPresets(dir, {}, undefined);
    expect(projectType).toBe('browser');
    expect(projectTypeReason).toContain('index.html');
  });

  it('prefers a browser project when a browser framework is next to a Node backend', () => {
    const { projectType, projectTypeReason } = detectPresets(
      dir,
      { dependencies: { '@nestjs/core': '^11.0.0', react: '^19.0.0' } },
      undefined,
    );
    expect(projectType).toBe('browser');
    expect(projectTypeReason).toContain('react');
  });

  it.each([
    [{ dependencies: { '@nestjs/core': '^11.0.0' } }, '@nestjs/core'],
    [{ bin: './cli.js' }, 'bin'],
    [{}, 'no browser framework'],
  ])('detects a Node project (%o)', (packageJson, reason) => {
    const { projectType, projectTypeReason } = detectPresets(dir, packageJson, undefined);
    expect(projectType).toBe('node');
    expect(projectTypeReason).toContain(reason);
  });

  it('detects TypeScript from the typescript dependency or .ts sources', () => {
    expect(
      detectPresets(dir, { devDependencies: { typescript: '^5.9.0' } }, undefined).reasons
        .typescript,
    ).toContain('typescript');
    mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'env.d.ts'), '');
    expect(detectPresets(dir, {}, undefined).reasons.typescript).toBeUndefined();
    writeFileSync(path.join(dir, 'src', 'app', 'main.ts'), '');
    expect(detectPresets(dir, {}, undefined).reasons.typescript).toContain('.ts');
  });
});

describe('detectTestFiles', () => {
  it('falls back to test/**', () => {
    expect(detectTestFiles(dir)).toEqual(['test/**']);
  });

  it('finds test, tests, tst and tsts folders in the project root', () => {
    for (const folder of ['tests', 'tst', 'tsts', 'testing', 'src/test']) {
      mkdirSync(path.join(dir, folder), { recursive: true });
    }
    writeFileSync(path.join(dir, 'test'), '');
    expect(detectTestFiles(dir)).toEqual(['tests/**', 'tst/**', 'tsts/**']);
  });
});

describe('detectBrowserFiles', () => {
  it('falls back to src/**', () => {
    expect(detectBrowserFiles(dir, ['test/**'])).toEqual(['src/**']);
  });

  it('finds every outermost src folder outside the test folders', () => {
    for (const folder of [
      'src/features/x/src',
      'apps/web/src',
      'apps/admin/src',
      'test/fixtures/a/src',
      'node_modules/pkg/src',
      '.cache/src',
    ]) {
      mkdirSync(path.join(dir, folder), { recursive: true });
    }
    expect(detectBrowserFiles(dir, ['./test/**'])).toEqual([
      'apps/admin/src/**',
      'apps/web/src/**',
      'src/**',
    ]);
  });
});

describe('detectSrcDirs', () => {
  it('falls back to src', () => {
    expect(detectSrcDirs(dir)).toEqual(['src']);
  });

  it('finds every src folder with the app / features / support layout', () => {
    for (const folder of [
      'src/app',
      'apps/web/src/features',
      'apps/admin/src/support',
      'apps/admin/src/features/x/src/app',
      'apps/docs/src/pages',
      'node_modules/pkg/src/app',
      '.cache/src/app',
    ]) {
      mkdirSync(path.join(dir, folder), { recursive: true });
    }
    expect(detectSrcDirs(dir)).toEqual(['apps/admin/src', 'apps/web/src', 'src']);
  });
});

describe('excludeTestSrcDirs', () => {
  it('drops src folders inside a test folder glob', () => {
    expect(
      excludeTestSrcDirs(
        ['apps/web/src', 'test/fixtures/a/src', 'src', 'packages/x/__tests__/src'],
        ['./test/**', '**/__tests__/**', '**/*.test.ts'],
      ),
    ).toEqual(['apps/web/src', 'src']);
  });

  it('falls back to src when every folder is a test folder', () => {
    expect(excludeTestSrcDirs(['test/fixtures/a/src'], ['test/**'])).toEqual(['src']);
  });
});
