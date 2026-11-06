# @uselab/linting

Company-wide ESLint (flat config) and Prettier configuration for Uselab projects.
Composable presets for **JavaScript, TypeScript, Vue, React and Node**, plus a fixed [project structure, guided by the principles of Domain-Driven Design (DDD)](#project-structure-boundaries).

## Install

The package is published on the public npm registry, so no `.npmrc` or access token is needed. Install it together with its peer dependencies (`eslint`, `prettier`, `typescript`) and `jiti`:

```sh
npm install -D @uselab/linting eslint prettier typescript jiti
```

All ESLint plugins are bundled as dependencies. `prettier` and `typescript` are optional peers: `typescript` is only needed for TS projects. `jiti` lets ESLint load a TypeScript config (`eslint.config.ts` / `.mts`).

## Quick start

Run the setup CLI in your project (or pass a target directory):

```sh
npx @uselab/linting init [dir]
```

Running it without a command (`npx @uselab/linting`) in an interactive terminal runs `init` in the current directory.

`init` runs inside a git repository without uncommitted changes (`git status --porcelain` is empty, untracked files included), so every change it makes can be reviewed and reverted.

The CLI replaces the existing lint/format setup of the project with the Uselab setup. It:

- detects the project and preselects presets accordingly, showing why: `javascript` and `boundaries` (the [project structure](#project-structure-boundaries)) always; `prettier` when the project has any file Prettier can format (the reason shows the first matched type in the order `.ts`, `.js`, `.vue`, `.jsx`, `.tsx`, `.json`, then the rest: `.mjs`, `.cjs`, `.mts`, `.cts`, `.jsonc`, `.json5`, `.css`, `.scss`, `.less`, `.html`, `.md`, `.yaml`, `.graphql`, ...; `node_modules`, build output and dot directories are skipped); `typescript` for a tsconfig, `typescript` dependency or `.ts` files in `src`; `vue` for `vue` / `nuxt`; `react` for `react` / `react-dom` / `next`; `browser` for vue / react / svelte / vite or an `index.html`; `aliases` for a bundler that resolves path aliases (vite / nuxt / next / webpack / `@rsbuild/core` / parcel); `node` for express / fastify / koa / hono / `@nestjs/*`, a `bin` field, or when nothing browser-related is found. Presets of an existing `@uselab/linting` config are preselected too;
- prompts for the presets (`javascript`, `typescript`, `node`, `browser`, `prettier`, `vue`, `react`, `aliases`, `boundaries`; plus, for `javascript`, the [test file globs](#test-files) (comma separated, prefilled with those of an existing config or the default `test/**`), and for `boundaries` (project structure), the [src folders](#project-structure-boundaries) (prefilled with those of an existing config, else the `src` folders that contain `app/`, `features/` or `support/` outside the test file globs (e.g. not `test/fixtures/app/src`), else `src`) and the tsconfig(s) that include them (prefilled with those of an existing config, else the detected ones; leave empty to let the preset detect them)), and which files ESLint lints: all files, all except some globs (opt-out, e.g. `legacy/**`) or only some globs (opt-in, e.g. `src/**, test/**`; a `!glob` skips files within them, e.g. `!src/legacy/**`; root config files such as `eslint.config.ts` are still linted). The scope is written to [`globalIgnores()`](#ignores), together with the default ignores, and preselected from an existing config;
- sets `"type": "module"` in `package.json` when it is missing or e.g. `"commonjs"`. This decides the config file name: `eslint.config.ts` in `"type": "module"` projects, otherwise `eslint.config.mts` (`.mts` is always an ES module, while a `.ts` file follows `"type"`). It scans the `.js`, `.jsx`, `.ts` and `.tsx` files (skipping `node_modules`, build output, dot directories, the lint/format configs it replaces, minified files (`*.min.*` or a line over 500 characters) and UMD wrappers (`typeof module` / `typeof exports` / `define.amd`, which fall back to a global as an ES module)) for CommonJS code that breaks as an ES module: `require()`, `module.exports`, `exports.x =`, `__dirname`, `__filename`, `import x = require()` and `export =`. It lists up to 10 lines with CommonJS code (`file:line  patterns`). When set while there is CommonJS code, all places are written to `REFACTOR-COMMON-JS.md` as a checklist (one item per line, with the code shortened to about 100 characters around the match) with how to fix them (convert, or rename the file to `.cjs` / `.cts`);
- adds a [GitHub Copilot hook](#github-copilot-hook);
- removes the existing lint/format tooling: other `eslint.config.*` files, legacy `.eslintrc*` / `.eslintignore`, other Prettier configs (`.prettierrc*`, `prettier.config.*`), Biome, TSLint, XO, oxlint and dprint configs, the `eslintConfig`, `eslintIgnore`, `prettier`, `standard` and `xo` keys of `package.json`, and the packages they used (`@eslint/*`, `eslint-plugin-*`, `eslint-config-*`, `@scope/eslint-config*`, `typescript-eslint`, `@typescript-eslint/*`, `prettier-plugin-*`, `@biomejs/biome`, `tslint`, `standard`, `xo`, `oxlint`, `dprint`, ...). `eslint`, `prettier`, `jiti`, `typescript`, `globals` and `.prettierignore` are kept;
- writes `eslint.config.ts` / `eslint.config.mts` (and `prettier.config.ts` / `prettier.config.mts` when `prettier` is selected, with the same `.ts` / `.mts` choice), overwriting existing files. An existing `prettier.config.ts` / `.mts` that already extends `@uselab/linting/prettier` is kept (renamed when the extension changes), so your overrides survive. If the project already has a `@uselab/linting` config (`export default [...]` or `defineConfig([...])`, also under another `eslint.config.*` name, which is then renamed), it is updated in place instead: selected presets are added in the canonical order, deselected ones removed, changed `javascript()` test file globs, `boundaries()` options and `globalIgnores()` lint scope rewritten (the `...configs.javascript` spread of older versions becomes `...configs.javascript()`, and the removed `...configs.ignores([...])` becomes `globalIgnores([...])`) (options of 1.x that no longer exist, such as `include` or `elements`, are dropped with a warning; a `globalIgnores()` or `configs.ignores()` with non-literal patterns is left unchanged with a warning, and the scope isn't asked), while custom entries are kept;
- adds or updates what the ESLint config needs in `devDependencies` (`eslint`, `jiti`, `@uselab/linting`, plus `prettier`, `typescript`, `vue-tsc` (with `typescript` + `vue`) and `vite-plugin-checker`, depending on the presets);
- writes the `lint` / `lint:fix` / `lint:analyze` (`uselab-linting analyze`) scripts (plus `format` / `format:check` when `prettier` is selected, and `typecheck` when `typescript` is selected) to `package.json`, overwriting existing scripts with those names, and warns about other scripts that still run removed tools. `typecheck` uses `vue-tsc` with the `vue` preset, otherwise `tsc`: `-b` for a solution-style root tsconfig (`references` with `files: []` or without `files` / `include`), else `--noEmit` (plus `--noEmit -p tsconfig.node.json` when that file exists). Without a tsconfig, no `typecheck` script is written and it warns. It is a separate script, so run it next to `lint` in CI;
- when `typescript` is selected in a Vite project, adds [`vite-plugin-checker`](https://vite-plugin-checker.netlify.app/) to the `plugins` of `vite.config.*` (and `devDependencies`), so type errors (`typescript`, or `vueTsc` with `vue`, using the tsconfig that includes `src`) and ESLint errors show in the terminal and browser overlay during `vite` and fail `vite build` (`enableBuild: true` is set explicitly, independent of the plugin's default). An existing `vite-plugin-checker` setup is left unchanged; configs it can't edit get a snippet;
- when `aliases` is selected, adds the missing [path aliases](#path-aliases) to the tsconfig that includes each src folder (`src`, or the `boundaries` src folders; following `references` of a solution-style `tsconfig.json`, e.g. to `tsconfig.app.json`);
- does the same for `resolve.alias` in `vite.config.{ts,mts,js,mjs}` (Vite doesn't read tsconfig `paths`), with the aliases pointing to `src`: missing aliases are merged into the config's object or `defineConfig({ ... })` (also when exported through a variable, e.g. `const config = defineConfig({ ... }); export default config`), together with the `node:url` import. Configs it can't edit (e.g. `defineConfig(() => ({ ... }))` or an array `alias`) get a snippet to add manually;
- when `typescript` is selected, checks whether the tsconfigs that include the src folders allow implicit `any` (the effective `noImplicitAny`, else `strict`, following `extends`, including packages such as `@vue/tsconfig`) and sets `"noImplicitAny": true`. Explicit `any` is already an error through `@typescript-eslint/no-explicit-any`;
- when a TypeScript Vite config imports Node builtins (such as that `node:url` import), adds `@types/node` to `devDependencies` if it is missing (matching the major of `engines.node`, else `^24`) and configures its tsconfig to load the Node types: a tsconfig that only covers the Vite config gets `"node"` added to its `types` (or `"types": ["node"]` when it has none: TypeScript 6 no longer loads `@types/*` packages by default); a tsconfig that also covers `src` hands the Vite config over to a `tsconfig.node.json` with `"types": ["node"]`, so Node types don't leak into browser code. That file is added to the `references` of a solution-style `tsconfig.json` only; a tsconfig with its own files can't reference a `noEmit` project, so type-check it with `tsc -p tsconfig.node.json`. When only a glob (e.g. `*.ts`) includes the Vite config, it warns instead;
- writes the Copilot hook to `.github/hooks/uselab-linting.json` in the repository root (the closest directory with `.git`), overwriting it;
- renames configs with `git mv` (a plain rename when git can't move the file, e.g. when it is untracked) and stages the files it created or renamed with `git add` (the ESLint / Prettier config, a new `tsconfig.node.json` and the Copilot hook), so `git status` shows them as added or renamed. `REFACTOR-COMMON-JS.md` is left untracked, and other changes (such as `package.json`) are left unstaged. Files git can't add (e.g. ignored files) are reported;
- offers to run the [lint analysis](#analyze) right away (default: yes). When init added or removed packages, or a required package is missing or too old in `node_modules`, it first offers to run `npm install` (or the `npm install -D ...` command without a `package.json`); when that is declined or fails, the analysis is skipped;
- otherwise prints the remaining steps: `npm install` when packages were added or removed, and `npm run lint`.

A single tsconfig is enough for linting. The `tsconfig.app.json` / `tsconfig.node.json` split of Vite templates is only needed to type-check app and tooling files with different settings.

### GitHub Copilot hook

`.github/hooks/uselab-linting.json` is a `postToolUse` [hook](https://docs.github.com/en/copilot/reference/hooks-reference) for Copilot CLI and Copilot in the cloud. After every file edit by the agent (`edit`, `create`, `apply_patch`, `str_replace_editor`), it runs `npx --no uselab-linting copilot-hook` in the project directory (`cwd` is set when the project is in a subdirectory of the repository). That command:

- formats the edited files of the project with Prettier (when a Prettier config applies, Prettier has a parser for the file and it isn't ignored by the `.gitignore` / `.prettierignore` of the project directory);
- runs `eslint --fix` on them (with the cache of the `lint` script), formatting again when ESLint changed something;
- tells the agent `uselab-linting: ok`, or lists the errors that remain (`file:line:column  message  (rule)`). Warnings are not reported. When a file was changed, the agent is told to view it before editing it again.

It needs `@uselab/linting`, `eslint` and (for formatting) `prettier` installed in the project; in Copilot in the cloud, install the dependencies in `copilot-setup-steps.yml`.

### Analyze

```sh
npx uselab-linting analyze [dir]
```

Lints the whole project like the `lint` script (`eslint .` with its cache, without fixing) and prints the rules that report errors or warnings, most relevant first: ordered by the number of errors without an autofix, then warnings without an autofix, then auto-fixable errors, then auto-fixable warnings (suggestions don't count as autofix). Each rule shows its counts (e.g. `12 errors (4 fixable), 3 warnings in 5 files`), the files with problems (most problems first, with their count) and up to 2 code excerpts (`file:line:column  message`, the offending line with one line of context), from different files when possible, preferring problems without an autofix and never showing the same code twice. Parse errors are listed as `(parse error)`.

In an interactive terminal it first asks whether to exclude the auto-fixable problems (default: yes). After the report it shows one row per reported rule with an action: use ↑/↓ to move, ←/→ or space to cycle **keep** → **disable** → **ignore with comments**, and enter to confirm (every rule starts at keep); esc continues without changes. Above the rows it explains: _Ignore with comments leaves the existing code unchanged and keeps the rule active for new code._ Above the rules is an **Edit ESLint ignore configuration** row, for when files are linted that shouldn't be or files are missed that should be. Press ↑ to reach it; enter on it applies the chosen actions and then asks only for the globs of the `globalIgnores()` entry, prefilled with the current ones: the files to skip (empty lints all files) or, for an opt-in scope, the files to lint, where `!glob` skips files within them (e.g. `src/**, !src/legacy/**`). The globs are relative to the ESLint config's folder, which the prompt mentions when it isn't the analyzed folder. When the config isn't a `@uselab/linting` config or its patterns aren't literals, it only says to change `globalIgnores([...])` by hand.

Disabled rules are turned off in a `// disable-rules` entry of the ESLint config (the file ESLint uses for the project), right before `...configs.prettier` (or at the end of the config array when there is none); on a later run, newly disabled rules are added to that entry:

```ts
  // disable-rules
  {
    rules: {
      'vue/no-setup-props-reactivity-loss': 'off',
    },
  },
  ...configs.prettier,
```

Configs it can't edit (not an `export default [...]` / `defineConfig([...])` array) get a snippet to add manually.

Ignored rules get an `eslint-disable-next-line` comment above each reported problem (only the reported ones, so auto-fixable problems stay when they were excluded). Rules with problems on the same line share one comment, and an existing `eslint-disable-next-line` comment above the line is extended. The comment matches the code:

- JS/TS: `// eslint-disable-next-line rule-a, rule-b`
- JSX children (`.jsx`/`.tsx`, Vue `lang="tsx"`): `{/* eslint-disable-next-line rule */}`
- Vue `<template>`: `<!-- eslint-disable-next-line rule -->`; Vue `<script>`: `//`
- First line, which may hold file-level problems: `/* eslint-disable rule */` before it and `/* eslint-enable rule */` after it (Vue: `<!-- eslint-disable rule -->` at the top)

Lines inside multi-line strings and files of other types are skipped and listed.

When rules were disabled or ignored, or the ignores changed, ESLint runs again, prints the new report and asks again for the remaining rules (disabled and ignored rules drop out; a rule stays only for problems that couldn't get a comment). This repeats until you confirm with every rule on keep, or press esc to continue without changes (ctrl+c cancels). When the report still has problems, it then offers to write it to `LINT-ANALYSIS.md` (not added to git); when it reports [project structure](#project-structure-boundaries) problems, the file explains the structure at the end and those rules refer to it. It exits with 1 when the final report contains errors.

## Usage

Spread the presets you need into `eslint.config.ts` (or `.js` / `.mjs`), after the [global ignores](#ignores). **`configs.prettier` must be last.**

### Vue + TypeScript

```ts
import { globalIgnores } from 'eslint/config';
import { configs } from '@uselab/linting';

export default [
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo']),
  ...configs.javascript(),
  ...configs.typescript,
  ...configs.vue,
  ...configs.browser,
  ...configs.aliases, // Vite resolves the path aliases
  ...configs.boundaries({ tsconfig: 'tsconfig.app.json' }), // optional
  ...configs.prettier,
];
```

### React + TypeScript

```ts
export default [
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo']),
  ...configs.javascript(),
  ...configs.typescript,
  ...configs.react,
  ...configs.browser,
  ...configs.prettier,
];
```

### Node (TypeScript or JavaScript)

```ts
export default [
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo']),
  ...configs.javascript(),
  ...configs.typescript, // omit for plain JS
  ...configs.node,
  ...configs.prettier,
];
```

### Overriding rules

Add your own config objects after the presets (but before `configs.prettier`):

```ts
export default [
  ...configs.javascript(),
  { files: ['src/legacy/**'], rules: { complexity: 'off' } },
  ...configs.prettier,
];
```

### Prettier

`init` writes a `prettier.config.ts` (`prettier.config.mts` without `"type": "module"`) that spreads the shared config. Add your overrides after the spread:

```ts
import type { Config } from 'prettier';
import uselab from '@uselab/linting/prettier';

const config: Config = {
  ...uselab,
  printWidth: 120,
};

export default config;
```

Prettier loads TypeScript configs since 3.5, using Node's built-in type stripping (Node 22.18+).

## Presets

| Preset                 | Contents                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javascript(options?)` | `@eslint/js` recommended, `import-x` recommended, sonarjs/unicorn picks and the house rules (no `null`, no class declarations, function expressions instead of declarations, no named callbacks, size/complexity limits, kebab-case filenames, ...). Root-level JS/TS files and `*.cjs` get Node globals. Options: `testFiles`. See [Test files](#test-files). |
| `typescript`           | `typescript-eslint` recommended for `.ts/.tsx/.mts/.cts/.vue`, `type` over `interface`, inline type imports, no type assertions, TS-aware import resolution.                                                                                                                                                                                                   |
| `vue`                  | `eslint-plugin-vue` flat/recommended, Vue house rules (block order, type-based props, type-literal emits, no `:style`, no `props.x` in templates, ...) and the custom `template-structure/no-redundant-conditional-wrapper` rule.                                                                                                                              |
| `react`                | `@eslint-react` recommended (`recommended-typescript` for TS files), `eslint-plugin-react-hooks` `recommended-latest`, no inline `style`, no `props.x` in JSX, no useless fragments.                                                                                                                                                                           |
| `browser`              | Browser globals + no imperative DOM class/attribute mutation (`classList.add/remove/toggle`, `setAttribute`, ...) in `src/`.                                                                                                                                                                                                                                   |
| `node`                 | Node globals for all files.                                                                                                                                                                                                                                                                                                                                    |
| `aliases`              | Bundler projects only: no parent-relative imports (`../x`); use the `@app` / `@features` / `@support` path aliases. See [Path aliases](#path-aliases).                                                                                                                                                                                                         |
| `boundaries(options?)` | Project structure, guided by the principles of Domain-Driven Design (DDD): the fixed `app` / `features` / `support` layout of each src folder and its import rules (`eslint-plugin-boundaries`). Options: `srcDirs`, `tsconfig`. See [Project structure](#project-structure-boundaries).                                                                       |
| `prettier`             | `eslint-config-prettier`: turns off rules that conflict with Prettier. Always last.                                                                                                                                                                                                                                                                            |

### Size limits

| Rule                      | Limit                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| `max-lines`               | 500 per file (off for `.vue`, `eslint.config.*` and [test files](#test-files)) |
| `max-lines-per-function`  | 100 (off for [test files](#test-files))                                        |
| `vue/max-lines-per-block` | `<template>` 200, `<script>` 300, `<style>` 300                                |

Blank lines are not counted; comments are not counted except by `vue/max-lines-per-block`.

### Ignores

The global ignores are ESLint's own [`globalIgnores()`](https://eslint.org/docs/latest/use/configure/ignore) (from `eslint/config`), with the full list written out in `eslint.config.*`, so you see everything that is ignored. The VS Code ESLint extension reads them from there, so the editor uses the same scope as `npm run lint`. `init` asks for the scope and writes it here, followed by the defaults `**/dist/**`, `**/node_modules/**` and `**/*.tsbuildinfo` (also exported as `DEFAULT_IGNORES`). The defaults are added whichever scope you choose (all files, opt-out or opt-in), and `init` mentions them in the scope question. Other generated folders, such as `coverage`, are linted unless you add them as opt-out globs (e.g. `coverage/**`). The `**/coverage/**` default of earlier versions is dropped when `init` or `analyze` rewrites the entry.

```ts
// Opt-out: lint everything except legacy code.
globalIgnores([
  'legacy/**',
  'src/old/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/*.tsbuildinfo',
]),

// Opt-in: lint only src and test, except src/legacy (plus root config files such as eslint.config.ts).
globalIgnores([
  '**/*', // ignore everything...
  '!**/*/', // ...but look inside folders, so the patterns below can match
  '!*.{js,mjs,cjs,ts,mts,cts}', // lint root config files (eslint.config.ts, vite.config.ts, ...)
  '!src/**',
  '!test/**',
  'src/legacy/**', // skip files within the linted globs
  '**/dist/**',
  '**/node_modules/**',
  '**/*.tsbuildinfo',
]),
```

`'!**/*/'` is required in opt-in mode: ESLint doesn't look inside ignored folders, so without it `!src/**` would never match. Order matters: keep the defaults (`dist`, `node_modules`, ...) after your patterns, so `!src/**` doesn't bring back `src/dist`, and put opt-in exclusions such as `src/legacy/**` after the globs they narrow. These patterns only affect ESLint; use `.prettierignore` for Prettier.

`configs.ignores()` of earlier versions no longer exists; `init` replaces it with `globalIgnores([...])`.

### Test files

Test files get relaxed rules: `max-lines` and `max-lines-per-function` are off. By default, a test file is any file in the root `test/` folder (`test/**`). Pass `testFiles` to use other globs, for example for test files next to your source files. They replace the default, so include it if you still want it:

```ts
...configs.javascript({ testFiles: ['test/**', '**/*.{test,spec}.{js,ts}'] }),
```

`init` prompts for these globs; leave the prompt empty when the project has no test files (`testFiles: []`). `javascript` is a function: configs of older versions that spread `...configs.javascript` must use `...configs.javascript()` (`init` updates them for you).

### Dev mode

`no-console`, `no-debugger` and unused-vars rules are **warnings** locally and **errors** in CI (when the `CI` env var is set and `NODE_ENV` is not `development`).

### Path aliases

With the `aliases` preset, parent-relative imports (`../x`) are not allowed (`no-restricted-imports`); import via the `@app`, `@features` and `@support` aliases instead. Only use it when a bundler resolves the aliases (Vite, Nuxt, Next.js, webpack, ...): Node and `tsc` don't rewrite tsconfig `paths`, so leave it out for Node projects. `boundaries()` still checks relative imports, so `../` imports across the layout are reported there too. In earlier versions this rule was part of `javascript()`; add `...configs.aliases` to keep it (`init` adds it when it detects a bundler).

Define the aliases in the tsconfig that includes `src` (`tsconfig.app.json` for Vite projects); with several src folders, each tsconfig maps the aliases to its own src folder. Paths are resolved relative to the tsconfig, so no `baseUrl` is needed (it is deprecated in TypeScript 6):

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

and the matching `resolve.alias` in `vite.config.ts` (`init` adds these for you):

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

`boundaries()` resolves the aliases with the same tsconfig; see [Which tsconfig is used](#which-tsconfig-is-used).

### Project structure (boundaries)

`boundaries()` enforces the Uselab project structure, guided by the principles of Domain-Driven Design (DDD): code is organised by business feature, each feature is a bounded context that only depends on itself and generic `support/` code, and `app/` composes the features. It is a company pattern, so the layout and its rules are fixed; you can only tell the preset **where** the src folders are and **which tsconfig** resolves their imports.

#### The layout

Every src folder has the same three folders:

```text
src/
├── app/            # app shell: entry, routing, layout, pages composing features
├── features/
│   ├── cart/       # one folder per feature
│   └── orders/
├── support/        # generic helpers, UI components, API clients; no business features
└── env.d.ts        # only declaration files may live elsewhere in src
```

Every source file (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`, `.vue`) in a src folder must be in `app/`, `features/` or `support/`. Entry files such as `main.ts` and `App.vue` belong in `app/`; a folder with source files such as `src/router/` is reported as well (move it into one of the three). Other files (CSS, images) are not reported themselves, but [importing them](#imports-from-outside-the-layout) is. Only declaration files (`*.d.ts`, e.g. Vite's `vite-env.d.ts`) are allowed anywhere. The rule is `uselab-layout/file-location`: "Files in `<src folder>`/ must be in app/, features/ or support/. Entry files such as main.ts belong in app/."

| From \ to       | `app/` | same feature | other feature | `support/` | elsewhere in src |
| --------------- | ------ | ------------ | ------------- | ---------- | ---------------- |
| `app/`          | ✅     | ✅           | ✅            | ✅         | ❌               |
| `features/<x>/` | ❌     | ✅           | ❌            | ✅         | ❌               |
| `support/`      | ❌     | ❌           | ❌            | ✅         | ❌               |

Files outside the src folders are not checked. The import rule is `boundaries/dependencies`; it reports static imports, `export ... from`, dynamic `import()` and `require()`.

Features talk to each other through `app/` (which composes them) or by moving the shared code to `support/`.

#### Imports from outside the layout

A file in `app/`, `features/` or `support/` may not import any file elsewhere in its src folder, including CSS, images and other assets (e.g. `src/main.css` or `src/router/`): "Imports from outside app/, features/ and support/ are not allowed. Move the file into one of them." Relative (`../main.css`) and alias (`@/main.css`) imports are reported by `boundaries/dependencies`. Path-style imports that the resolver can't follow, `/src/main.css` (Vite) and `src/main.css`, are reported by `uselab-layout/import-location`, which recognises the src folder path (e.g. `apps/web/src/...`) or its folder name with or without a leading `/`. Imports between files that are both outside the layout are not checked.

#### Multiple src folders

One ESLint config can cover several src folders, e.g. in a monorepo:

```ts
configs.boundaries({ srcDirs: ['apps/web/src', 'apps/admin/src'] });
```

Each src folder has its own `app/`, `features/` and `support/` and the rules above apply within it. **src folders are isolated**: a file in one src folder may not import from another one (`apps/admin/src/features/x` importing `apps/web/src/support/y` is reported), and two features with the same name in different src folders are different features. Share code through a package instead.

#### Options

| Option     | Type                 | Default             | Description                                                                                                                               |
| ---------- | -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `srcDirs`  | `string[]`           | `['src']`           | The src folders, relative to the directory ESLint runs in (the project root). Every source file in them is checked. They can't be nested. |
| `tsconfig` | `string \| string[]` | Detected per folder | tsconfig(s) used to resolve imports such as `@features/cart`. Only needed when the [detection](#which-tsconfig-is-used) picks wrong.      |

`init` writes both: the detected src folders (only when they differ from `['src']`) and the tsconfig that includes each of them.

#### Which tsconfig is used

The preset can only check an import it can resolve to a file. An aliased import (`@features/cart`) that can't be resolved, because the tsconfig with the `paths` isn't used, is **silently not checked**. So the tsconfig matters, especially in projects with separate configs for browser and Node code (the Vite template: `tsconfig.app.json` for `src`, `tsconfig.node.json` for `vite.config.ts`).

Without the `tsconfig` option, the preset looks for each src folder, starting in the folder that contains it and going up to the project root, for a `tsconfig.json` (or, when a folder has none, `tsconfig.app.json`) and picks:

1. the config that includes the src folder (an `include` entry that is the src folder or a parent of it, or no `include` / `files` at all), following the `references` of a solution-style `tsconfig.json` (`files: []` + `references`). So `tsconfig.app.json` is used and `tsconfig.node.json`, which only includes `vite.config.ts`, is never picked;
2. otherwise the nearest config (or, when it is solution-style, its first reference).

Pass `tsconfig` (relative to the project root) when your setup differs, e.g. a tsconfig with another name. With several src folders, pass one per folder; each file is resolved with the tsconfig that includes it.

#### Running ESLint

`srcDirs` and the tsconfig detection are relative to the **current working directory**, so run ESLint from the project root (the directory of `eslint.config.*`), as the `lint` script does. In VS Code with the config in a subfolder, set `"eslint.workingDirectories": [{ "mode": "auto" }]`.

#### Upgrading from 1.x

The layout is no longer configurable. Remove these options and exports (`init` removes the options for you):

- `elements`, `policies`: the layout and its rules are fixed.
- `include`, `files`: every source file in `srcDirs` is checked. Use `srcDirs` for other src folders, e.g. `include: ['packages/web/src/**']` becomes `srcDirs: ['packages/web/src']`.
- `rootPath`: paths are relative to the directory ESLint runs in; make `srcDirs` relative to it.
- Files directly in a src folder (such as `main.ts`) are no longer allowed (reported by `uselab-layout/file-location`); move them to `app/` by hand.
- The exports `defaultBoundaryElements`, `defaultBoundaryPolicies`, `BoundaryElement` and `BoundaryPolicy`.

## Development

```sh
npm install
npm test          # vitest suite (see Tests below)
npm run lint      # the package lints itself with its own presets
npm run build     # tsup -> dist/
```

### Trying changes in a test project with `npm link`

The package is consumed from `dist/`, so build it before linking.

In this module:

```sh
npm install
npm run build
npm link                  # registers @uselab/linting (and the uselab-linting bin) globally
npx tsup --watch          # optional: rebuild dist/ on every change
```

In the test project:

```sh
npm install -D eslint prettier typescript jiti   # peer dependencies, if not installed yet
npm link @uselab/linting                         # symlinks node_modules/@uselab/linting to this repo
npx eslint .                                     # or: npx uselab-linting
```

Changes are picked up after each rebuild; just re-run ESLint (restart the ESLint server in your editor if it caches the config).

Notes:

- Run `npm link @uselab/linting` again after any `npm install` in the test project, since installing removes the symlink.
- Both projects should use the same Node version (`npm link` uses the global prefix of the active Node).
- The linked package resolves its plugins from this repo's `node_modules`, so run `npm install` here first.

To undo:

```sh
# in the test project
npm unlink @uselab/linting
npm install

# in this module
npm unlink -g @uselab/linting
```

### Source layout

`src/` follows the package's own [boundaries](#project-structure-boundaries) layout:

- `src/app/`: the entry points (`index.ts`, `cli.ts`, `prettier.ts`), mapped to `dist/` by `tsup.config.ts`.
- `src/features/`: `eslint-presets` (one file per preset), `prettier` (the shared Prettier config) and `cli` (the `init` CLI and the Copilot hook).
- `src/support/`: code shared by features: the ESLint plugins (`eslint-plugins/`), `DEFAULT_IGNORES`, dev mode, tsconfig detection and shared types.

### Tests

- `test/cli/`: the `init` CLI and the Copilot hook.
- `test/plugins/`: the `template-structure` plugin rule (RuleTester). The `uselab-layout/file-location` and `uselab-layout/import-location` rules are tested through `test/rules/boundaries.test.ts`.
- `test/rules/`: every house rule that has options, tested at its limits (e.g. `max-params` 3 passes, 4 fails), plus dev-mode severity, file-scoped overrides, preset order, `globalIgnores()` with `DEFAULT_IGNORES` and `boundaries()` (the layout rules, file location, tsconfig detection and multiple src folders, using the `boundaries*` fixtures).
- `test/presets/imported-sets.test.ts`: checks that each imported rule set is active, using one known rule per set, and the Node globals.
- `test/prettier.test.ts`: formats code with the shared Prettier config.

House rules without options and the contents of imported rule sets are deliberately not tested.

Publishing: create a GitHub release; the `Publish` workflow publishes to npm (with provenance). It needs an npm automation token in the `NPM_TOKEN` repository secret.

## Contributing

Issues and pull requests are welcome. Run `npm test`, `npm run lint` and `npm run typecheck` before opening a pull request.

## License

[ISC](https://opensource.org/license/isc-license-txt)
