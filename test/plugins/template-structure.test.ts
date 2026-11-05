import { RuleTester } from 'eslint';
import vueParser from 'vue-eslint-parser';
import { describe, it } from 'vitest';
import { plugins } from '../../src/app';

RuleTester.describe = describe;
RuleTester.it = it;

const rule = plugins.templateStructure.rules?.['no-redundant-conditional-wrapper'];
if (!rule) {
  throw new Error('no-redundant-conditional-wrapper rule not found');
}

const ruleTester = new RuleTester({
  languageOptions: { parser: vueParser, ecmaVersion: 2022, sourceType: 'module' },
});

const template = (body: string): string => `<template>\n  ${body}\n</template>`;
// messageId is a stable key, so the message text can change without breaking these tests.
const messageId = 'redundantWrapper';
const error = { messageId, line: 2 };

ruleTester.run('template-structure/no-redundant-conditional-wrapper', rule, {
  valid: [
    { name: 'no conditional', code: template('<div><p>text</p></div>') },
    {
      name: 'conditional on the element itself',
      code: template('<p v-if="show">text</p>'),
    },
    {
      name: 'multiple element children',
      code: template('<div v-if="show"><p>a</p><p>b</p></div>'),
    },
    {
      name: 'element and text children',
      code: template('<div v-if="show">label <p>a</p></div>'),
    },
    { name: 'only text child', code: template('<div v-if="show">text</div>') },
    { name: 'only interpolation child', code: template('<span v-if="show">{{ value }}</span>') },
    { name: 'empty wrapper', code: template('<div v-if="show"></div>') },
    {
      name: 'conditional is not the first attribute',
      code: template('<div class="box" v-if="show"><p>a</p></div>'),
    },
    {
      name: 'class attribute makes the wrapper meaningful',
      code: template('<div v-if="show" class="box"><p>a</p></div>'),
    },
    {
      name: 'bound class makes the wrapper meaningful',
      code: template('<div v-if="show" :class="cls"><p>a</p></div>'),
    },
    {
      name: 'style makes the wrapper meaningful',
      code: template('<span v-if="show" style="color: red"><b>a</b></span>'),
    },
    {
      name: 'v-show makes the wrapper meaningful',
      code: template('<div v-if="show" v-show="visible"><p>a</p></div>'),
    },
    {
      name: 'object v-bind makes the wrapper meaningful',
      code: template('<div v-if="show" v-bind="attrs"><p>a</p></div>'),
    },
    {
      name: 'meaningful attribute next to ignorable ones',
      code: template('<div key="a" v-if="show" @click="go" id="x"><p>a</p></div>'),
    },
    {
      name: 'other directive first',
      code: template('<div v-show="show"><p>a</p></div>'),
    },
    {
      name: 'other wrapper tags are allowed',
      code: template('<section v-if="show"><p>a</p></section>'),
    },
    {
      name: 'template wrapper is allowed',
      code: template('<template v-if="show"><p>a</p></template>'),
    },
    {
      name: 'outside a template block',
      code: '<script setup lang="ts">\nconst show = true;\n</script>',
    },
  ],
  invalid: [
    {
      name: 'div v-if with one element child',
      code: template('<div v-if="show"><p>a</p></div>'),
      errors: [error],
    },
    {
      name: 'span v-if with one element child',
      code: template('<span v-if="show"><b>a</b></span>'),
      errors: [error],
    },
    {
      name: 'v-else-if wrapper',
      code: template('<p v-if="a">a</p>\n  <div v-else-if="b"><p>b</p></div>'),
      errors: [{ messageId, line: 3 }],
    },
    {
      name: 'v-else wrapper',
      code: template('<p v-if="a">a</p>\n  <div v-else><p>b</p></div>'),
      errors: [{ messageId, line: 3 }],
    },
    {
      name: 'whitespace around the single child is ignored',
      code: template('<div v-if="show">\n    <p>a</p>\n  </div>'),
      errors: [error],
    },
    {
      name: 'key is ignored',
      code: template('<div v-if="show" key="a"><p>a</p></div>'),
      errors: [error],
    },
    {
      name: 'bound key before the conditional is ignored',
      code: template('<div :key="id" v-if="show"><p>a</p></div>'),
      errors: [error],
    },
    {
      name: 'ref is ignored',
      code: template('<div v-if="show" ref="wrapper"><p>a</p></div>'),
      errors: [error],
    },
    {
      name: 'event listeners are ignored',
      code: template('<span v-if="show" @click="go" v-on:keyup="go"><b>a</b></span>'),
      errors: [error],
    },
    {
      name: 'nested wrappers report each level',
      code: template('<div v-if="a"><span v-if="b"><p>c</p></span></div>'),
      errors: [error, error],
    },
  ],
});
