import { createRequire } from 'node:module';
import type { Config } from 'prettier';

// Resolve plugins from this package so they work regardless of the consumer's node_modules layout.
const require = createRequire(import.meta.url);

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
  plugins: [require.resolve('prettier-plugin-curly')],
};

export default config;
