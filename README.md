# @uselab/linting

Company-wide ESLint (flat config) and Prettier configuration for Uselab projects.
Composable presets for **JavaScript, TypeScript, Vue, React and Node**, plus a fixed [project structure, guided by the principles of Domain-Driven Design (DDD)](#project-structure-boundaries).

## Install

```sh
npm install -D @uselab/linting eslint prettier typescript jiti
```

All ESLint plugins are bundled. `prettier` and `typescript` are optional peers (`typescript` only for TS projects). `jiti` lets ESLint load `eslint.config.ts`.

## Quick start

```sh
npx @uselab/linting init [dir]
```

Run it in a git repository without uncommitted changes, so you can review and revert everything it does. `init` replaces the existing lint/format setup:

- detects the project (browser or Node, Vue, React, TypeScript, bundler, ...) and preselects presets, then asks you to confirm them (and the [query library](#query-libraries)), the [test file globs](#test-files), the [src folders](#project-structure-boundaries) and the lint scope ([`globalIgnores()`](#ignores));
- sets `"type": "module"` in `package.json` and writes `eslint.config.ts` / `.mts` (and `prettier.config.ts` / `.mts`). An existing `@uselab/linting` config is updated in place and custom entries are kept. Remaining CommonJS code is listed in `REFACTOR-COMMON-JS.md`;
- removes other ESLint, Prettier, Biome, TSLint, XO, oxlint and dprint configs and their packages;
- updates `devDependencies` and adds the `lint`, `lint:fix`, `lint:analyze` scripts (plus `format`, `format:check` with `prettier` and `typecheck` with `typescript`);
- adds the [Copilot hook](#github-copilot-hook);
- with `typescript` in a Vite project, adds `vite-plugin-checker`; with `aliases`, adds the [path aliases](#path-aliases) to the tsconfig and `vite.config.*`; sets `noImplicitAny`;
- stages the files it creates or renames with git, and offers to run `npm install` and the [analysis](#analyze).

### GitHub Copilot hook

`.github/hooks/uselab-linting.json` is a `postToolUse` [hook](https://docs.github.com/en/copilot/reference/hooks-reference) for Copilot CLI and Copilot in the cloud. After every file edit by the agent it runs `npx --no uselab-linting copilot-hook`, which formats the edited files with Prettier, runs `eslint --fix`, and reports `uselab-linting: ok` or the remaining errors. Install the dependencies in `copilot-setup-steps.yml` for Copilot in the cloud.

### Analyze

```sh
npx uselab-linting analyze [dir]
```

Lints the project like the `lint` script and lists the rules that report problems, most relevant first (errors without autofix, then warnings, then auto-fixable ones), with counts, files and code excerpts.

In an interactive terminal you choose an action per rule:

- **keep**: leave the rule as is;
- **disable**: turn the rule off in a `// disable-rules` entry of the ESLint config;
- **ignore with comments**: add `eslint-disable-next-line` comments above the existing problems; the rule stays active for new code.

An **Edit ESLint ignore configuration** row lets you change the `globalIgnores()` scope. ESLint then re-runs until you confirm with every rule on keep (esc continues without changes). Remaining problems can be written to `LINT-ANALYSIS.md`. Exits with 1 when the final report contains errors.

## Usage

Spread the presets you need into `eslint.config.ts`, after the [global ignores](#ignores). **`configs.prettier` must be last.**

### Vue + TypeScript

```ts
import { globalIgnores } from 'eslint/config';
import { configs } from '@uselab/linting';

export default [
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo']),
  ...configs.javascript(),
  ...configs.typescript,
  ...configs.vue,
  ...configs.browser({ files: ['src/**'] }), // browser globals for the app code
  ...configs.node({ ignores: ['src/**'] }), // Node globals for everything else
  ...configs.aliases, // Vite resolves the path aliases
  ...configs.boundaries({ tsconfig: 'tsconfig.app.json' }), // optional
  ...configs.prettier,
];
```

### React + TypeScript

Same as Vue, with `...configs.react` instead of `...configs.vue` (and without `aliases` unless a bundler resolves them).

### Node (TypeScript or JavaScript)

Use `...configs.javascript()`, `...configs.typescript` (omit for plain JS), `...configs.node()` and `...configs.prettier`.

### Overriding rules

Add your own config objects after the presets, before `configs.prettier`:

```ts
export default [
  ...configs.javascript(),
  { files: ['src/legacy/**'], rules: { complexity: 'off' } },
  ...configs.prettier,
];
```

### Prettier

`init` writes a `prettier.config.ts` that spreads the shared config. Add overrides after the spread:

```ts
import type { Config } from 'prettier';
import uselab from '@uselab/linting/prettier';

const config: Config = { ...uselab, printWidth: 120 };

export default config;
```

Prettier loads TypeScript configs since 3.5 (Node 22.18+).

## Presets

| Preset                 | Contents                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `javascript(options?)` | ESLint, import-x, sonarjs and unicorn picks plus house rules (no `null`, kebab-case filenames, size limits, ...). Option: `testFiles`.                                         |
| `typescript`           | `typescript-eslint` recommended, `type` over `interface`, inline type imports, no type assertions.                                                                             |
| `vue`                  | `eslint-plugin-vue` recommended, house rules (block order, type-based props and emits, ...), `template-structure` rule.                                                        |
| `vueA11y`              | `eslint-plugin-vuejs-accessibility` recommended. Opt-in in the config; the CLI preselects it when `vue` is detected.                                                           |
| `react`                | `@eslint-react` and `react-hooks` recommended, no inline `style`, no `props.x` in JSX.                                                                                         |
| `query(options?)`      | Server state via a query library: no `fetch`, no HTTP clients (axios, ky, ...) outside `allow`. Options: `library`, `allow`, `files`. See [Query libraries](#query-libraries). |
| `browser(options?)`    | Browser globals and no imperative DOM mutation. Options: `files`, `ignores`.                                                                                                   |
| `node(options?)`       | Node globals. Options: `files`, `ignores`; default: all files.                                                                                                                 |
| `aliases`              | Bundler projects only: no `../x` imports; use [path aliases](#path-aliases).                                                                                                   |
| `boundaries(options?)` | The fixed `app` / `features` / `support` [project structure](#project-structure-boundaries). Options: `srcDirs`, `tsconfig`.                                                   |
| `prettier`             | `eslint-config-prettier`. Always last.                                                                                                                                         |

### Query libraries

`configs.query({ library })` bans `fetch` (and `window/globalThis/self.fetch`) and imports of axios, ky, got, superagent, node-fetch and ofetch, so requests go through a query library. Raw HTTP stays allowed in `allow` (default `['src/support/http/**']`).

| Framework | `library`                                     |
| --------- | --------------------------------------------- |
| Vue       | `vue-query` (default), `pinia-colada`, `swrv` |
| React     | `react-query` (default), `swr`, `rtk-query`   |

`init` selects `query` for Vue and React projects, preselects an already declared library, and adds the library packages to `dependencies`.

### Size limits

| Rule                      | Limit                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| `max-lines`               | 500 per file (off for `.vue`, `eslint.config.*` and [test files](#test-files)) |
| `max-lines-per-function`  | 100 (off for [test files](#test-files))                                        |
| `vue/max-lines-per-block` | `<template>` 200, `<script>` 300, `<style>` 300                                |

Blank lines are not counted.

### Ignores

Global ignores use ESLint's [`globalIgnores()`](https://eslint.org/docs/latest/use/configure/ignore), written out in `eslint.config.*` so the editor and `npm run lint` share one scope. `init` asks for the scope and appends the defaults `**/dist/**`, `**/node_modules/**` and `**/*.tsbuildinfo` (exported as `DEFAULT_IGNORES`).

```ts
// Opt-out: lint everything except legacy code.
globalIgnores(['legacy/**', '**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo']),

// Opt-in: lint only src and test, except src/legacy (plus root config files).
globalIgnores([
  '**/*', // ignore everything...
  '!**/*/', // ...but look inside folders, so the patterns below can match
  '!*.{js,mjs,cjs,ts,mts,cts}', // root config files
  '!src/**',
  '!test/**',
  'src/legacy/**', // skip files within the linted globs
  '**/dist/**',
  '**/node_modules/**',
  '**/*.tsbuildinfo',
]),
```

Keep the defaults after your patterns, and opt-in exclusions after the globs they narrow. These only affect ESLint; use `.prettierignore` for Prettier.

### Test files

Test files (default `test/**`) have `max-lines` and `max-lines-per-function` turned off. Pass `testFiles` to replace the default:

```ts
...configs.javascript({ testFiles: ['test/**', '**/*.{test,spec}.{js,ts}'] }),
```

### Dev mode

`no-console`, `no-debugger` and unused-vars rules are **warnings** locally and **errors** in CI (`CI` set and `NODE_ENV` not `development`).

### Path aliases

The `aliases` preset forbids parent-relative imports (`../x`); import via `@app`, `@features` and `@support` instead. Use it only when a bundler resolves the aliases (Vite, Nuxt, Next.js, webpack, ...). `node()` after `aliases` turns the rule off for Node files.

Define the aliases in the tsconfig that includes `src` (paths resolve relative to the tsconfig, no `baseUrl` needed):

```json
{
  "compilerOptions": {
    "paths": {
      "@app/*": ["./src/app/*"],
      "@features/*": ["./src/features/*"],
      "@support/*": ["./src/support/*"]
    }
  }
}
```

and the matching `resolve.alias` in `vite.config.ts` (`init` adds both):

```ts
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '@support': fileURLToPath(new URL('./src/support', import.meta.url)),
    },
  },
});
```

### Project structure (boundaries)

`boundaries()` enforces the Uselab project structure, guided by the principles of Domain-Driven Design (DDD): code is organised by business feature, each feature is a bounded context that only depends on itself and generic `support/` code, and `app/` composes the features. It is a company pattern, so the layout and its rules are fixed; you can only tell the preset **where** the src folders are and **which tsconfig** resolves their imports.

#### The layout

```text
src/
├── app/            # app shell: entry, routing, layout, pages composing features
├── features/
│   ├── cart/       # one folder per feature
│   └── orders/
├── support/        # generic helpers, UI components, API clients; no business features
└── env.d.ts        # only declaration files may live directly in src
```

Every source file in a src folder must be in `app/`, `features/` or `support/` (rule `uselab-layout/file-location`). Entry files such as `main.ts` belong in `app/`.

| From \ to       | `app/` | same feature | other feature | `support/` | elsewhere in src |
| --------------- | ------ | ------------ | ------------- | ---------- | ---------------- |
| `app/`          | ✅     | ✅           | ✅            | ✅         | ❌               |
| `features/<x>/` | ❌     | ✅           | ❌            | ✅         | ❌               |
| `support/`      | ❌     | ❌           | ❌            | ✅         | ❌               |

Imports are checked by `boundaries/dependencies` (static, `export ... from`, dynamic `import()`, `require()`), and path-style imports such as `/src/main.css` by `uselab-layout/import-location`. Files outside the src folders are not checked. Features share code through `app/` or by moving it to `support/`.

#### Multiple src folders

```ts
configs.boundaries({ srcDirs: ['apps/web/src', 'apps/admin/src'] });
```

Each src folder has its own layout and is isolated: files may not import from another src folder. Share code through a package.

#### Options

| Option     | Type                 | Default             | Description                                                     |
| ---------- | -------------------- | ------------------- | --------------------------------------------------------------- |
| `srcDirs`  | `string[]`           | `['src']`           | Src folders relative to the project root. They can't be nested. |
| `tsconfig` | `string \| string[]` | Detected per folder | tsconfig(s) used to resolve imports such as `@features/cart`.   |

#### Which tsconfig is used

Imports that can't be resolved are **silently not checked**, so the tsconfig with the `paths` must be used. Without the `tsconfig` option, the preset searches upward from each src folder for the `tsconfig.json` (or `tsconfig.app.json`) that includes it, following `references` of a solution-style config; otherwise it takes the nearest one. Pass `tsconfig` when your setup differs.

#### Running ESLint

Run ESLint from the project root, as the `lint` script does. In VS Code with the config in a subfolder, set `"eslint.workingDirectories": [{ "mode": "auto" }]`.

## Development

```sh
npm install
npm test          # vitest
npm run lint      # the package lints itself with its own presets
npm run build     # tsup -> dist/
```

To try changes in a test project, build, then link:

```sh
npm run build && npm link        # in this module (optionally: npx tsup --watch)
npm link @uselab/linting         # in the test project (repeat after every npm install there)
npx eslint .
```

Undo with `npm unlink @uselab/linting` in the test project and `npm unlink -g @uselab/linting` here.

`src/` follows the package's own [boundaries](#project-structure-boundaries) layout: `app/` holds the entry points, `features/` the `eslint-presets`, `prettier` and `cli`, and `support/` the shared code (ESLint plugins, `DEFAULT_IGNORES`, tsconfig detection).

Tests live in `test/` (`cli`, `plugins`, `rules`, `presets`, `prettier.test.ts`). House rules without options and imported rule sets are deliberately not tested in depth.

Publishing: create a GitHub release; the `Publish` workflow publishes to npm with provenance (needs the `NPM_TOKEN` repository secret).

## Contributing

Issues and pull requests are welcome. Run `npm test`, `npm run lint` and `npm run typecheck` before opening a pull request.

## License

[MIT](LICENSE) © Uselab
