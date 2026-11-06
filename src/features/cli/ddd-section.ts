/** The rules that report violations of the project structure (boundaries preset). */
export const BOUNDARY_RULES: readonly string[] = [
  'boundaries/dependencies',
  'uselab-layout/file-location',
  'uselab-layout/import-location',
];

export const DDD_SECTION_HEADING = 'Project structure (DDD)';
export const DDD_SECTION_ANCHOR = '#project-structure-ddd';

/** Copied from the "Project structure (boundaries)" section of README.md; a test keeps them in sync. */
export const DDD_INTRO =
  '`boundaries()` enforces the Uselab project structure, guided by the principles of Domain-Driven Design (DDD): code is organised by business feature, each feature is a bounded context that only depends on itself and generic `support/` code, and `app/` composes the features. It is a company pattern, so the layout and its rules are fixed; you can only tell the preset **where** the src folders are and **which tsconfig** resolves their imports.';

export const DDD_TABLE = [
  '| From \\ to       | `app/` | same feature | other feature | `support/` | elsewhere in src |',
  '| --------------- | ------ | ------------ | ------------- | ---------- | ---------------- |',
  '| `app/`          | ✅     | ✅           | ✅            | ✅         | ❌               |',
  '| `features/<x>/` | ❌     | ✅           | ❌            | ✅         | ❌               |',
  '| `support/`      | ❌     | ❌           | ❌            | ✅         | ❌               |',
].join('\n');

/** The markdown lines of the DDD section. */
export const dddSectionLines = (): string[] => [
  `## ${DDD_SECTION_HEADING}`,
  '',
  DDD_INTRO,
  '',
  DDD_TABLE,
];

export const isBoundaryRule = (ruleId: string): boolean => BOUNDARY_RULES.includes(ruleId);

export const DDD_REFERENCE = `See [${DDD_SECTION_HEADING}](${DDD_SECTION_ANCHOR}).`;
