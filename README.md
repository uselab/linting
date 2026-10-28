# @uselab/linting

Company-wide ESLint (flat config) and Prettier configuration for Uselab projects.
Composable presets for **JavaScript, TypeScript, Vue, React and Node**.

## Install

The package is published to GitHub Packages. Add an `.npmrc` to your project:

```ini
@uselab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install it together with the peer dependencies:

```sh
npm install -D @uselab/linting eslint prettier typescript jiti
```

All ESLint plugins are bundled as dependencies. `typescript` is only needed for TS projects; `jiti` only when your config is `eslint.config.ts`.

## Usage

Spread the presets you need into `eslint.config.ts` (or `.js` / `.mjs`). **`configs.prettier` must be last.**

### Vue + TypeScript

```ts
import { configs } from '@uselab/linting';

export default [
  ...configs.ignores(),
  ...configs.javascript,
  ...configs.typescript,
  ...configs.vue,
  ...configs.browser,
  ...configs.boundaries({ tsconfig: 'tsconfig.app.json' }), // optional
  ...configs.prettier,
];
```

### React + TypeScript

```ts
export default [
  ...configs.ignores(),
  ...configs.javascript,
  ...configs.typescript,
  ...configs.react,
  ...configs.browser,
  ...configs.prettier,
];
```

### Node (TypeScript or JavaScript)

```ts
export default [
  ...configs.ignores(),
  ...configs.javascript,
  ...configs.typescript, // omit for plain JS
  ...configs.node,
  ...configs.prettier,
];
```

### Overriding rules

Add your own config objects after the presets (but before `configs.prettier`):

```ts
export default [
  ...configs.javascript,
  { files: ['src/legacy/**'], rules: { complexity: 'off' } },
  ...configs.prettier,
];
```

### Prettier

In `package.json`:

```json
{ "prettier": "@uselab/linting/prettier" }
```

Or extend it in `prettier.config.js`:

```js
import uselab from '@uselab/linting/prettier';

export default { ...uselab, printWidth: 120 };
```

## Presets

| Preset                 | Contents                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignores(extra?)`      | Global ignores: `dist`, `node_modules`, `coverage`, `*.tsbuildinfo` + any extra globs.                                                                                                                                                              |
| `javascript`           | `@eslint/js` recommended, `import-x` recommended, sonarjs/unicorn picks and the house rules (no `null`, no classes, arrow functions only, size/complexity limits, kebab-case filenames, ...). Root-level config files and `*.cjs` get Node globals. |
| `typescript`           | `typescript-eslint` recommended for `.ts/.tsx/.mts/.cts/.vue`, `type` over `interface`, inline type imports, no type assertions, TS-aware import resolution.                                                                                        |
| `vue`                  | `eslint-plugin-vue` flat/recommended, Vue house rules (block order, type-based props/emits, no `:style`, no `props.x` in templates, ...) and the custom `template-structure/no-redundant-conditional-wrapper` rule.                                 |
| `react`                | `@eslint-react` recommended, `eslint-plugin-react-hooks` recommended, no inline `style`, no `props.x` in JSX, no useless fragments.                                                                                                                 |
| `browser`              | Browser globals + no imperative DOM class/attribute mutation (`classList.*`, `setAttribute`, ...) in `src/`.                                                                                                                                        |
| `node`                 | Node globals for all files.                                                                                                                                                                                                                         |
| `boundaries(options?)` | Opt-in architecture boundaries (`eslint-plugin-boundaries`). Default layout: `src/app`, `src/features/*`, `src/support`. Options: `elements`, `policies`, `files`, `include`, `tsconfig`, `rootPath`.                                               |
| `prettier`             | `eslint-config-prettier`: turns off rules that conflict with Prettier. Always last.                                                                                                                                                                 |

### Dev mode

`no-console`, `no-debugger` and unused-vars rules are **warnings** locally and **errors** in CI (when the `CI` env var is set and `NODE_ENV` is not `development`).

### Boundaries options

You can leave out any option. If you pass `elements` or `policies`, your list replaces the default list.

| Option     | Type                 | Default                                                                                                  | Description                                                                                                                  |
| ---------- | -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `files`    | `string[]`           | All source files                                                                                         | Files the `boundaries/dependencies` rule runs on.                                                                            |
| `elements` | `BoundaryElement[]`  | `app` (`src/app/**`), `feature` (`src/features/*`, captures `featureName`), `support` (`src/support/**`) | Architectural elements: `{ type, pattern, capture?, mode? }` (`mode`: `'file' \| 'folder' \| 'full'`).                       |
| `policies` | `BoundaryPolicy[]`   | See [default policies](#boundaries-default-policies)                                                     | Dependency policies in `eslint-plugin-boundaries` v7 syntax, with an optional `message`. Anything not disallowed is allowed. |
| `include`  | `string[]`           | `['src/**']`                                                                                             | Globs of files that boundaries classifies into elements.                                                                     |
| `tsconfig` | `string \| string[]` | Found automatically                                                                                      | tsconfig(s) used to resolve imports, e.g. path aliases like `@/`.                                                            |
| `rootPath` | `string`             | `process.cwd()`                                                                                          | Project root that element patterns are relative to. Useful in monorepos.                                                     |

`defaultBoundaryElements` and `defaultBoundaryPolicies` are exported, so you can extend the defaults:

```ts
import { configs, defaultBoundaryElements, defaultBoundaryPolicies } from '@uselab/linting';

configs.boundaries({
  elements: [...defaultBoundaryElements, { type: 'shared', pattern: 'src/shared/**' }],
  policies: [
    ...defaultBoundaryPolicies,
    {
      from: { element: { type: 'shared' } },
      disallow: { to: { element: { type: 'feature' } } },
      message: 'shared/ must not import from features/.',
    },
  ],
});
```

### Boundaries default policies

- features must not import other features or `app/`
- `support/` must not import `features/` or `app/`

Customise:

```ts
configs.boundaries({
  elements: [
    { type: 'page', pattern: 'src/pages/*' },
    { type: 'shared', pattern: 'src/shared/**' },
  ],
  policies: [
    {
      from: { element: { type: 'shared' } },
      disallow: { to: { element: { type: 'page' } } },
      message: 'shared/ must not import pages.',
    },
  ],
});
```

## Development

```sh
npm install
npm test          # vitest suite (see Tests below)
npm run lint      # the package lints itself with its own presets
npm run build     # tsup -> dist/
```

### Tests

- `test/plugins/`: the custom ESLint plugin rules (RuleTester).
- `test/rules/`: every house rule that has options, tested at its limits (e.g. `max-params` 3 passes, 4 fails), plus dev-mode severity, file-scoped overrides, `ignores()` and `boundaries()` options.
- `test/presets/imported-sets.test.ts`: checks that each imported rule set is active, using one known rule per set.
- `test/prettier.test.ts`: formats code with the shared Prettier config.

House rules without options and the contents of imported rule sets are deliberately not tested.

Publishing: create a GitHub release; the `Publish` workflow publishes to GitHub Packages.
