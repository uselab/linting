import vueA11y from 'eslint-plugin-vuejs-accessibility';
import { VUE_FILES, type Config } from '../../support/shared';

/**
 * Opt-in Vue accessibility preset: eslint-plugin-vuejs-accessibility recommended rules.
 * Use together with the `vue` preset, which keeps control of parsing; only the rules are taken
 * from the plugin's config (its flat config also sets a parser and browser globals).
 * Rules that often give false positives in component libraries are warnings.
 */
export const vueA11yPreset: Config[] = [
  {
    name: 'uselab/vue-a11y/rules',
    files: VUE_FILES,
    plugins: { 'vuejs-accessibility': { rules: vueA11y.rules } },
    rules: {
      ...vueA11y.configs.recommended.rules,
      'vuejs-accessibility/no-autofocus': 'warn',
      'vuejs-accessibility/label-has-for': 'warn',
    },
  },
];
