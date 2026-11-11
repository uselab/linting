import { describe, expect, it } from 'vitest';
import { configs, type Config } from '../../src/app';
import { lintRule } from '../helpers';

const config = [...configs.javascript(), ...configs.typescript(), ...configs.vue()];
const FILE = 'src/components/user-card.vue';

const sfc = (template: string, script = ''): string =>
  `<template>\n  ${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`;

const repeat = (count: number, line: string): string =>
  Array.from({ length: count }, (_, index) => line.replaceAll('$i', String(index))).join('\n');

describe('vue/component-name-in-template-casing (kebab-case, registeredComponentsOnly)', () => {
  const rule = 'vue/component-name-in-template-casing';
  const script = "import UserAvatar from './user-avatar.vue';";

  it('reports PascalCase registered components', async () => {
    expect(await lintRule(config, rule)(FILE, sfc('<UserAvatar />', script))).toHaveLength(1);
  });

  it('allows kebab-case registered components', async () => {
    expect(await lintRule(config, rule)(FILE, sfc('<user-avatar />', script))).toEqual([]);
  });

  it('ignores unregistered (global) components', async () => {
    expect(await lintRule(config, rule)(FILE, sfc('<RouterLink to="/" />'))).toEqual([]);
  });
});

describe('vue/attribute-hyphenation (always)', () => {
  const rule = 'vue/attribute-hyphenation';

  it('reports camelCase attributes', async () => {
    expect(await lintRule(config, rule)(FILE, sfc('<user-avatar userName="a" />'))).toHaveLength(1);
  });

  it('allows hyphenated attributes', async () => {
    expect(await lintRule(config, rule)(FILE, sfc('<user-avatar user-name="a" />'))).toEqual([]);
  });
});

describe('vue/block-order (template, script, style)', () => {
  const rule = 'vue/block-order';
  const template = '<template>\n  <p>a</p>\n</template>\n';
  const script = '<script setup lang="ts">\nconst a = 1;\n</script>\n';
  const style = '<style scoped>\np { color: red; }\n</style>\n';

  it('allows template, script, style', async () => {
    expect(await lintRule(config, rule)(FILE, `${template}${script}${style}`)).toEqual([]);
  });

  it('reports script before template', async () => {
    expect(await lintRule(config, rule)(FILE, `${script}${template}${style}`)).toHaveLength(1);
  });

  it('reports style before script', async () => {
    expect(await lintRule(config, rule)(FILE, `${template}${style}${script}`)).toHaveLength(1);
  });
});

describe('vue/define-props-declaration (type-based)', () => {
  const rule = 'vue/define-props-declaration';

  it('reports runtime declarations', async () => {
    const code = sfc('<p>{{ title }}</p>', 'defineProps({ title: String });');
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('allows type-based declarations', async () => {
    const code = sfc('<p>{{ title }}</p>', 'defineProps<{ title: string }>();');
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });
});

describe('vue/define-emits-declaration (type-literal)', () => {
  const rule = 'vue/define-emits-declaration';

  it('reports runtime declarations', async () => {
    const code = sfc('<p>a</p>', "defineEmits(['change']);");
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('reports call-signature declarations', async () => {
    const code = sfc('<p>a</p>', "defineEmits<{ (event: 'change', id: number): void }>();");
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('allows type-literal declarations', async () => {
    const code = sfc('<p>a</p>', 'defineEmits<{ change: [id: number] }>();');
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });
});

describe('vue/no-restricted-syntax', () => {
  const rule = 'vue/no-restricted-syntax';
  const script = 'const props = defineProps<{ title: string }>();\nconsole.info(props.title);';

  it('reports props.<name> in templates', async () => {
    const code = sfc('<p>{{ props.title }}</p>', script);
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('reports :style bindings', async () => {
    const code = sfc('<p :style="{ color: \'red\' }">a</p>');
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('allows the prop directly and :class bindings', async () => {
    const code = sfc('<p :class="{ active: true }">{{ title }}</p>', script);
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });
});

describe('vue/max-lines-per-block (template 200, script 300, style 300, skip blank lines)', () => {
  const rule = 'vue/max-lines-per-block';
  const block = (tag: string, lines: string): string =>
    `<${tag}>\n${lines}\n</${tag.split(' ')[0]}>\n`;
  const blank = '\n\n\n';

  it('allows 200 template lines plus blank lines', async () => {
    const code = block('template', `${blank}${repeat(200, '<p>$i</p>')}${blank}`);
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });

  it('reports 201 template lines', async () => {
    expect(
      await lintRule(config, rule)(FILE, block('template', repeat(201, '<p>$i</p>'))),
    ).toHaveLength(1);
  });

  it('allows 300 script lines', async () => {
    const code = block('script setup lang="ts"', repeat(300, 'const a$i = $i;'));
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });

  it('reports 301 script lines', async () => {
    const code = block('script setup lang="ts"', repeat(301, 'const a$i = $i;'));
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('allows 300 style lines', async () => {
    const code = block('style', repeat(300, '.a$i { color: red; }'));
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });

  it('reports 301 style lines', async () => {
    const code = block('style', repeat(301, '.a$i { color: red; }'));
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });
});

describe('max-lines (off for .vue files)', () => {
  it('allows a file over 500 lines when every block is within its limit', async () => {
    const code = [
      `<template>\n<div>\n${repeat(198, '<p>$i</p>')}\n</div>\n</template>`,
      `<script setup lang="ts">\n${repeat(300, 'const a$i = $i;')}\n</script>`,
      `<style>\n${repeat(300, '.a$i { color: red; }')}\n</style>\n`,
    ].join('\n');
    expect(await lintRule(config, 'max-lines')(FILE, code)).toEqual([]);
  });
});

describe('preset order', () => {
  const orders: [string, Config[]][] = [
    ['vue before typescript', [...configs.javascript(), ...configs.vue(), ...configs.typescript()]],
    ['vue after typescript', [...configs.javascript(), ...configs.typescript(), ...configs.vue()]],
  ];

  it.each(orders)('parses <script lang="ts"> and applies options (%s)', async (_label, ordered) => {
    const code = sfc('<p>{{ title }}</p>', 'defineProps({ title: String });');
    expect(await lintRule(ordered, 'vue/define-props-declaration')(FILE, code)).toHaveLength(1);
  });
});
