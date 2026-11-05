import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPresets, detectSrcDirs, excludeTestSrcDirs } from '../../src/features/cli/detect';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-detect-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectPresets', () => {
  it('always selects javascript and boundaries, aliases only for a bundler', () => {
    const { presets } = detectPresets(dir, undefined, undefined);
    expect(presets).toEqual(['javascript', 'node', 'boundaries']);
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
      'browser',
      'aliases',
      'boundaries',
      'prettier',
    ]);
    expect(detection.reasons.typescript).toContain('tsconfig.app.json');
    expect(detection.reasons.aliases).toContain('vite');
    expect(detection.reasons.browser).toContain('vue');
  });

  it('detects React through next', () => {
    const { presets } = detectPresets(dir, { dependencies: { next: '^15.0.0' } }, undefined);
    expect(presets).toEqual(['javascript', 'react', 'browser', 'aliases', 'boundaries']);
  });

  it('detects a browser project from index.html', () => {
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    const { reasons } = detectPresets(dir, {}, undefined);
    expect(reasons.browser).toContain('index.html');
    expect(reasons.node).toBeUndefined();
  });

  it('detects a Node backend next to a browser framework', () => {
    const { presets, reasons } = detectPresets(
      dir,
      { dependencies: { '@nestjs/core': '^11.0.0', react: '^19.0.0' } },
      undefined,
    );
    expect(presets).toContain('node');
    expect(reasons.node).toContain('@nestjs/core');
  });

  it('detects node from a bin field', () => {
    writeFileSync(path.join(dir, 'index.html'), '');
    const { reasons } = detectPresets(dir, { bin: './cli.js' }, undefined);
    expect(reasons.node).toContain('bin');
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
