import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDependencies,
  patchPackageJson,
  requiredDependencies,
} from '../../src/features/cli/dependencies';
import { detectPresets } from '../../src/features/cli/detect';
import { readEslintConfig, updateEslintConfig } from '../../src/features/cli/eslint-config';
import { generateEslintConfig } from '../../src/features/cli/generate';
import { queryLibraryOptions } from '../../src/features/cli/prompts';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'uselab-query-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('detecting the query library', () => {
  const detect = (dependencies: Record<string, string>) =>
    detectPresets(tempDir(), { dependencies }, undefined);

  it('selects vue-query for Vue and react-query for React', () => {
    const vue = detect({ vue: '^3' });
    expect(vue.presets).toContain('query');
    expect(vue.queryLibrary).toBe('vue-query');
    expect(detect({ react: '^19' }).queryLibrary).toBe('react-query');
  });

  it('prefers an alternative that is already declared', () => {
    expect(detect({ vue: '^3', '@pinia/colada': '^1' }).queryLibrary).toBe('pinia-colada');
    expect(detect({ react: '^19', swr: '^2' }).queryLibrary).toBe('swr');
    expect(detect({ react: '^19', swr: '^2' }).reasons.query).toBe('swr dependency');
  });

  it('does not select it without Vue or React', () => {
    const result = detect({ express: '^5' });
    expect(result.presets).not.toContain('query');
    expect(result.queryLibrary).toBeUndefined();
  });
});

describe('query library options', () => {
  it('only offers the libraries of the selected frameworks', () => {
    expect(queryLibraryOptions(['react']).map(({ id }) => id)).toEqual([
      'react-query',
      'swr',
      'rtk-query',
    ]);
    expect(queryLibraryOptions(['vue']).map(({ id }) => id)).toEqual([
      'vue-query',
      'pinia-colada',
      'swrv',
    ]);
    expect(queryLibraryOptions(['javascript'])).toHaveLength(6);
  });
});

describe('generated config', () => {
  it('writes the query preset with its library', () => {
    const code = generateEslintConfig({
      presets: ['javascript', 'vue', 'query'],
      query: { library: 'vue-query' },
    });
    expect(code).toContain("  ...queryPreset({ library: 'vue-query' }),");
    expect(readEslintConfig(code)?.query).toEqual({ library: 'vue-query' });
  });

  it('updates the library of an existing config and keeps a custom allow list', () => {
    const code = generateEslintConfig({
      presets: ['javascript', 'query'],
      query: { library: 'swr', allow: ['src/api/**'] },
    });
    const update = updateEslintConfig(code, {
      presets: ['javascript', 'query'],
      query: { library: 'react-query', allow: ['src/api/**'] },
    });
    expect(update?.queryUpdated).toBe(true);
    expect(update?.code).toContain("library: 'react-query'");
    expect(update?.code).toContain("allow: ['src/api/**']");
    expect(
      updateEslintConfig(update?.code ?? '', {
        presets: ['javascript', 'query'],
        query: { library: 'react-query', allow: ['src/api/**'] },
      })?.queryUpdated,
    ).toBe(false);
  });

  it('adds the preset to an existing config', () => {
    const code = generateEslintConfig({ presets: ['javascript'] });
    const update = updateEslintConfig(code, {
      presets: ['javascript', 'query'],
      query: { library: 'vue-query' },
    });
    expect(update?.added).toEqual(['query']);
    expect(update?.code).toContain("queryPreset({ library: 'vue-query' })");
  });
});

describe('query dependencies', () => {
  it('requires the library packages as runtime dependencies', () => {
    const requirements = requiredDependencies(['query'], '1.0.0', { queryLibrary: 'pinia-colada' });
    const checks = checkDependencies({}, requirements).filter(({ runtime }) => runtime);
    expect(checks.map(({ name, field }) => [name, field])).toEqual([
      ['@pinia/colada', 'dependencies'],
      ['pinia', 'dependencies'],
    ]);
    const patched = patchPackageJson('{\n  "name": "x"\n}\n', checkDependencies({}, requirements));
    const parsed: unknown = JSON.parse(patched);
    expect(parsed).toMatchObject({
      dependencies: { '@pinia/colada': '^1.0.0' },
      devDependencies: { eslint: expect.any(String) },
    });
  });

  it('accepts a declared library of a new enough version', () => {
    const requirements = requiredDependencies(['query'], '1.0.0', { queryLibrary: 'vue-query' });
    const [check] = checkDependencies(
      { dependencies: { '@tanstack/vue-query': '^5.96.2' } },
      requirements,
    ).filter(({ name }) => name === '@tanstack/vue-query');
    expect(check?.status).toBe('ok');
  });

  it('adds nothing without the query preset', () => {
    expect(
      requiredDependencies(['javascript'], '1.0.0', { queryLibrary: 'swr' }).map(
        ({ name }) => name,
      ),
    ).not.toContain('swr');
  });
});
