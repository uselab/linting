import eslintConfigPrettier from 'eslint-config-prettier';
import type { Config } from '../../support/shared';

/**
 * Turns off rules that conflict with Prettier. Must be the last preset.
 */
export const prettier: Config[] = [{ ...eslintConfigPrettier, name: 'uselab/prettier' }];
