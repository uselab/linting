# TODO

- [ ] **React a11y preset (`reactA11yPreset`)**: add `eslint-plugin-jsx-a11y` (`flat.recommended`) as an opt-in preset, like `vueA11y`. Blocked: the latest version (6.10.2) only declares ESLint `^3 || ... || ^9` as a peer, but this package uses ESLint 10, so adding it as a dependency makes consumers' installs fail with `ERESOLVE`. Revisit when `jsx-a11y` supports ESLint 10. Until then, consider an optional peer dependency loaded lazily, or npm `overrides`. Set `no-autofocus` and `label-has-associated-control` to `warn`, as in `vueA11y`.
