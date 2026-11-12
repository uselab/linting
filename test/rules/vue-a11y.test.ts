import { describe, expect, it } from 'vitest';
import { javascriptPreset, typescriptPreset, vueA11yPreset, vuePreset } from '../../src/app';
import { configForFile, lintRule, severityOf } from '../helpers';

const config = [...javascriptPreset(), ...typescriptPreset(), ...vuePreset(), ...vueA11yPreset()];
const FILE = 'src/components/user-card.vue';

const sfc = (template: string): string =>
  `<template>\n  ${template}\n</template>\n\n<script setup lang="ts">\nconst a = 1;\n</script>\n`;

describe('vuejs-accessibility preset', () => {
  it('reports images without alt text', async () => {
    const rule = 'vuejs-accessibility/alt-text';
    expect(await lintRule(config, rule)(FILE, sfc('<img src="a.png" />'))).toHaveLength(1);
  });

  it('allows images with alt text', async () => {
    const rule = 'vuejs-accessibility/alt-text';
    expect(await lintRule(config, rule)(FILE, sfc('<img src="a.png" alt="a" />'))).toEqual([]);
  });

  it('keeps false-positive prone rules as warnings', async () => {
    const resolved = await configForFile(config, FILE);
    expect(severityOf(resolved, 'vuejs-accessibility/no-autofocus')).toBe(1);
    expect(severityOf(resolved, 'vuejs-accessibility/label-has-for')).toBe(1);
  });

  it('is not active without the preset', async () => {
    const resolved = await configForFile([...javascriptPreset(), ...vuePreset()], FILE);
    expect(severityOf(resolved, 'vuejs-accessibility/alt-text') ?? 0).toBe(0);
  });
});
