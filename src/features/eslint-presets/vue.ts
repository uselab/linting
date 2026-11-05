import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import { templateStructurePlugin } from '../../support/eslint-plugins/template-structure';
import { VUE_FILES, type Config } from '../../support/shared';

/**
 * Vue 3 preset: eslint-plugin-vue flat/recommended + Uselab Vue house rules and the custom
 * template-structure plugin. <script lang="ts"> is parsed with typescript-eslint's parser.
 */
export const vue: Config[] = [
  ...pluginVue.configs['flat/recommended'],
  {
    name: 'uselab/vue/rules',
    files: VUE_FILES,
    plugins: {
      'template-structure': templateStructurePlugin,
    },
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      'vue/no-static-inline-styles': 'error',
      'vue/component-name-in-template-casing': [
        'error',
        'kebab-case',
        { registeredComponentsOnly: true },
      ],
      'vue/attribute-hyphenation': ['error', 'always'],
      'vue/block-order': ['error', { order: ['template', 'script', 'style'] }],
      'vue/define-macros-order': 'error',
      'vue/define-props-declaration': ['error', 'type-based'],
      'vue/define-emits-declaration': ['error', 'type-literal'],
      'vue/require-default-prop': 'off',
      'vue/no-lone-template': 'error',
      'vue/no-setup-props-reactivity-loss': 'error',
      'template-structure/no-redundant-conditional-wrapper': 'error',
      'vue/no-restricted-syntax': [
        'error',
        {
          selector: "VExpressionContainer MemberExpression[object.name='props']",
          message: 'Avoid props.<name> in templates. Use the prop directly instead.',
        },
        {
          selector: "VAttribute[directive=true][key.name.name='bind'][key.argument.name='style']",
          message:
            'Do not use :style bindings in templates. Prefer component props and utility classes.',
        },
      ],
      // Blocks are limited separately, so the whole-file max-lines limit is not used for SFCs.
      'max-lines': 'off',
      'vue/max-lines-per-block': [
        'error',
        { template: 200, script: 300, style: 300, skipBlankLines: true },
      ],
    },
  },
];
