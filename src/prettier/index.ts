import type { Config } from 'prettier';

/**
 * Uselab shared Prettier config. Use via `"prettier": "@uselab/linting/prettier"` in package.json,
 * or spread it in a prettier.config.js to override options.
 */
const config: Config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  endOfLine: 'crlf',
  plugins: ['prettier-plugin-curly'],
};

export default config;
