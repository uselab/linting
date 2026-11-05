import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/app/index.ts',
    prettier: 'src/app/prettier.ts',
    cli: 'src/app/cli.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: {
    entry: {
      index: 'src/app/index.ts',
      prettier: 'src/app/prettier.ts',
    },
  },
  clean: true,
  sourcemap: false,
});
