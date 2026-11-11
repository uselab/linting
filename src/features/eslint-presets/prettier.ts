import eslintConfigPrettier from 'eslint-config-prettier';
import { scopeConfigs, type Config, type PresetOptions } from '../../support/shared';

/**
 * Turns off rules that conflict with Prettier. Must be the last preset.
 */
export const prettier = (options: PresetOptions = {}): Config[] =>
  scopeConfigs([{ ...eslintConfigPrettier, name: 'uselab/prettier' }], options);
