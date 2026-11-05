import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isScannedDirectory } from './detect';

export const REFACTOR_REPORT_FILE = 'REFACTOR-COMMON-JS.md';

export type CommonJsKind =
  | 'import = require()'
  | 'require()'
  | 'module.exports'
  | 'exports.x ='
  | 'export ='
  | '__dirname'
  | '__filename';

export type CommonJsUsage = {
  /** Path relative to the project, with forward slashes. */
  file: string;
  line: number;
  /** All patterns found on this line. */
  kinds: CommonJsKind[];
  /** The trimmed source line, shortened to about `SNIPPET_LENGTH` characters around the match. */
  text: string;
};

const SNIPPET_LENGTH = 100;
/** Files with a longer line are treated as minified (bundled third-party code). */
const MINIFIED_LINE_LENGTH = 500;
/** UMD wrappers only use CommonJS when `module` / `exports` exist, so they still load as ES modules. */
const UMD_GUARD = /\btypeof\s+(?:module|exports)\b|\bdefine\.amd\b/;

/** Files that follow `"type"`; `.cjs/.mjs/.cts/.mts` have a fixed module type. */
const SCANNED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

const PATTERNS: { kind: CommonJsKind; pattern: RegExp }[] = [
  { kind: 'import = require()', pattern: /^\s*import\s+[\w$]+\s*=\s*require\s*\(/ },
  { kind: 'require()', pattern: /(?<![\w$.])require(?:\.resolve)?\s*\(/ },
  { kind: 'module.exports', pattern: /(?<![\w$.])module\.exports\b/ },
  { kind: 'exports.x =', pattern: /(?<![\w$.])exports\.[\w$]+\s*=(?!=)/ },
  { kind: 'export =', pattern: /^\s*export\s*=(?!=)/ },
  { kind: '__dirname', pattern: /(?<![\w$.])__dirname\b/ },
  { kind: '__filename', pattern: /(?<![\w$.])__filename\b/ },
];

export const FIX_HINTS: Record<CommonJsKind, string> = {
  'import = require()': "use `import x from '...'`",
  'require()': "use `import` (or `createRequire(import.meta.url)` from 'node:module')",
  'module.exports': 'use `export default` / named `export`s',
  'exports.x =': 'use a named `export`',
  'export =': 'use `export default`',
  __dirname: 'use `import.meta.dirname`',
  __filename: 'use `import.meta.filename`',
};

const isCommentLine = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

const lineKinds = (line: string): CommonJsKind[] => {
  if (isCommentLine(line)) {
    return [];
  }
  const kinds = PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ kind }) => kind);
  return kinds.includes('import = require()')
    ? kinds.filter((kind) => kind !== 'require()')
    : kinds;
};

const snippet = (line: string, kinds: readonly CommonJsKind[]): string => {
  const text = line.trim();
  if (text.length <= SNIPPET_LENGTH) {
    return text;
  }
  const matchIndex = Math.min(
    ...PATTERNS.filter(({ kind }) => kinds.includes(kind)).map(
      ({ pattern }) => pattern.exec(text)?.index ?? 0,
    ),
  );
  const start = Math.max(
    0,
    Math.min(matchIndex - SNIPPET_LENGTH / 2, text.length - SNIPPET_LENGTH),
  );
  const end = start + SNIPPET_LENGTH;
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
};

const isMinified = (name: string, lines: readonly string[]): boolean =>
  /\.min\.[^.]+$/i.test(name) || lines.some((line) => line.length > MINIFIED_LINE_LENGTH);

const isScannedFile = (name: string): boolean =>
  SCANNED_EXTENSIONS.has(path.extname(name).toLowerCase()) && !name.endsWith('.d.ts');

const findSourceFiles = (projectDir: string, skipFiles: readonly string[]): string[] => {
  const files: string[] = [];
  const queue = [projectDir];
  for (let directory = queue.shift(); directory !== undefined; directory = queue.shift()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const file = path.relative(projectDir, absolutePath).split(path.sep).join('/');
      if (entry.isDirectory() && isScannedDirectory(entry.name)) {
        queue.push(absolutePath);
      } else if (entry.isFile() && isScannedFile(entry.name) && !skipFiles.includes(file)) {
        files.push(file);
      }
    }
  }
  return files.sort();
};

/**
 * Finds CommonJS code in the files that become ES modules with `"type": "module"`, skipping
 * dependencies, build output, dot directories and `skipFiles` (relative paths). Minified files
 * (`*.min.*` or a line over 500 characters) and UMD wrappers (which fall back to a global when
 * `module` / `exports` don't exist) are skipped too. One usage per line.
 */
export const findCommonJsUsages = (
  projectDir: string,
  skipFiles: readonly string[] = [],
): CommonJsUsage[] =>
  findSourceFiles(projectDir, skipFiles).flatMap((file) => {
    const lines = readFileSync(path.join(projectDir, file), 'utf8').split(/\r?\n/);
    if (isMinified(file, lines) || lines.some((line) => UMD_GUARD.test(line))) {
      return [];
    }
    return lines.flatMap((text, index) => {
      const kinds = lineKinds(text);
      return kinds.length === 0
        ? []
        : [{ file, line: index + 1, kinds, text: snippet(text, kinds) }];
    });
  });

/** One `file:line  kinds` line per usage, at most `limit`, followed by `…and N more`. */
export const formatUsages = (usages: readonly CommonJsUsage[], limit = 10): string => {
  const lines = usages
    .slice(0, limit)
    .map(({ file, line, kinds }) => `${file}:${line}  ${kinds.join(', ')}`);
  if (usages.length > limit) {
    lines.push(`…and ${usages.length - limit} more`);
  }
  return lines.join('\n');
};

/** Up to this many CommonJS usages, setting `"type": "module"` is the default answer. */
export const MODULE_TYPE_MAX_USAGES = 20;
const LISTED_USAGES = 10;

const plural = (count: number): string => (count === 1 ? 'usage' : 'usages');

const moduleTypeExplanation = (type: unknown): string =>
  [
    type === undefined
      ? 'package.json has no "type", so Node treats .js and .ts files as CommonJS.'
      : `package.json has "type": ${JSON.stringify(type)}, so Node treats .js and .ts files as CommonJS.`,
    'The ESLint config is therefore written as eslint.config.mts (.mts is always an ES module).',
    '',
    'With "type": "module", .js and .ts files are ES modules by default and the config',
    'becomes the more familiar eslint.config.ts. Vite and most modern templates already set it.',
    'CommonJS code (require / module.exports / __dirname) in .js and .ts files then fails to load.',
  ].join('\n');

const describeUsages = (usages: readonly CommonJsUsage[]): string => {
  if (usages.length === 0) {
    return 'No CommonJS code found, so it is safe to set.';
  }
  const lines = [
    `Found ${usages.length} CommonJS ${plural(usages.length)} to convert (or rename the file to .cjs / .cts):`,
    formatUsages(usages, LISTED_USAGES),
    '',
    `When set, all of them are listed in ${REFACTOR_REPORT_FILE}.`,
  ];
  if (usages.length > MODULE_TYPE_MAX_USAGES) {
    lines.push(`More than ${MODULE_TYPE_MAX_USAGES}, so the default is No.`);
  }
  return lines.join('\n');
};

/** Explains `"type": "module"` and lists the CommonJS code that would break. */
export const moduleTypeNote = (type: unknown, usages: readonly CommonJsUsage[]): string =>
  `${moduleTypeExplanation(type)}\n\n${describeUsages(usages)}`;

/** Logged after writing the report. */
export const reportWrittenMessage = (usages: readonly CommonJsUsage[]): string =>
  `Wrote ${REFACTOR_REPORT_FILE}: ${usages.length} CommonJS ${plural(usages.length)} to convert.`;

const inlineCode = (text: string): string => {
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
};

/** Markdown checklist of all usages, grouped per file, with how to fix each kind. */
export const refactorReport = (usages: readonly CommonJsUsage[]): string => {
  const files = [...new Set(usages.map(({ file }) => file))];
  const kinds = PATTERNS.map(({ kind }) => kind).filter((kind) =>
    usages.some((usage) => usage.kinds.includes(kind)),
  );
  return [
    '# Refactor CommonJS',
    '',
    '`"type": "module"` was added to package.json, so `.js`, `.jsx`, `.ts` and `.tsx` files are now',
    'ES modules. The places below still use CommonJS and fail to load until they are converted.',
    'Alternatively, rename a file to `.cjs` / `.cts` to keep it CommonJS.',
    '',
    'Delete this file when done.',
    '',
    '## How to fix',
    '',
    '| Pattern | Fix |',
    '| ------- | --- |',
    ...kinds.map((kind) => `| ${inlineCode(kind)} | ${FIX_HINTS[kind]} |`),
    '',
    `## Places (${usages.length} in ${files.length} ${files.length === 1 ? 'file' : 'files'})`,
    ...files.flatMap((file) => [
      '',
      `### ${inlineCode(file)}`,
      '',
      ...usages
        .filter((usage) => usage.file === file)
        .map(
          ({ line, kinds: lineKindList, text }) =>
            `- [ ] line ${line}: ${lineKindList.map(inlineCode).join(', ')} — ${inlineCode(text)}`,
        ),
    ]),
    '',
  ].join('\n');
};
