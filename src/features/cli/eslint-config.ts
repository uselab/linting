import { builders, generateCode, parseModule, type ASTNode, type ProxifiedModule } from 'magicast';
import { DEFAULT_IGNORES } from '../../support/ignores';
import {
  GLOBAL_IGNORES,
  GLOBAL_IGNORES_MODULE,
  IGNORE_EVERYTHING,
  ignoresExpression,
  KEEP_TOOLING_FILES,
  PRESET_ORDER,
  presetExpression,
  type BoundariesAnswers,
  type IgnoresAnswers,
  type InitAnswers,
  type JavaScriptAnswers,
  type PresetId,
} from './generate';

const PACKAGE = '@uselab/linting';

type ArrayNode = Extract<ASTNode, { type: 'ArrayExpression' }>;
type ElementNode = ArrayNode['elements'][number];

type UselabEntry = { name: string; node: ASTNode };

type ParsedConfig = {
  mod: ProxifiedModule;
  local: string;
  array: ArrayNode;
  /** Local name of `globalIgnores` imported from `eslint/config`, if imported. */
  ignoresLocal?: string;
};

export type ExistingConfig = {
  presets: PresetId[];
  javascript?: JavaScriptAnswers;
  /** False when the `javascript()` options aren't plain literals and can't be rewritten. */
  javascriptEditable: boolean;
  /** True for the `...configs.javascript` spread of older versions (now a function). */
  javascriptLegacy: boolean;
  boundaries?: BoundariesAnswers;
  /** False when the `boundaries()` options aren't plain literals and can't be rewritten. */
  boundariesEditable: boolean;
  /** Options of older versions (`rootPath`, `include`, ...) that are dropped on update. */
  boundariesRemovedOptions: string[];
  /** Lint scope of the `globalIgnores()` entry; `all` when there is none. */
  ignores?: IgnoresAnswers;
  /** False when the `globalIgnores()` patterns aren't plain literals or not a recognised scope. */
  ignoresEditable: boolean;
  /** True for the removed `...configs.ignores()` of older versions (now `globalIgnores()`). */
  ignoresLegacy: boolean;
};

export type ConfigUpdate = {
  code: string;
  added: PresetId[];
  removed: PresetId[];
  javascriptUpdated: boolean;
  boundariesUpdated: boolean;
  ignoresUpdated: boolean;
  /** True when the legacy `...configs.ignores()` was replaced by `globalIgnores()`. */
  ignoresMigrated: boolean;
  /** Removed `boundaries()` options that were dropped from the config. */
  boundariesRemovedOptions: string[];
};

const isPreset = (name: string): name is PresetId => PRESET_ORDER.some((preset) => preset === name);

/** Finds the config array of `export default [...]` or `export default defineConfig([...])`. */
const configArray = (node: ASTNode): ArrayNode | undefined => {
  if (node.type === 'ArrayExpression') {
    return node;
  }
  const [first] = node.type === 'CallExpression' ? node.arguments : [];
  return first?.type === 'ArrayExpression' ? first : undefined;
};

/** Parses an ESLint flat config that spreads `configs` imported from `@uselab/linting`. */
const parseConfig = (text: string): ParsedConfig | undefined => {
  try {
    const mod = parseModule(text);
    const item = mod.imports.$items.find(
      ({ from, imported }) => from === PACKAGE && imported === 'configs',
    );
    const array = configArray(mod.exports.default.$ast);
    const ignoresLocal = mod.imports.$items.find(
      ({ from, imported }) => from === GLOBAL_IGNORES_MODULE && imported === GLOBAL_IGNORES,
    )?.local;
    return item && array ? { mod, local: item.local, array, ignoresLocal } : undefined;
  } catch {
    return undefined;
  }
};

/** Returns `name` for `...configs.name` and `...configs.name(...)` spreads. */
const uselabEntry = (element: ElementNode, local: string): UselabEntry | undefined => {
  if (element?.type !== 'SpreadElement') {
    return undefined;
  }
  const { argument } = element;
  const member = argument.type === 'CallExpression' ? argument.callee : argument;
  if (
    member.type !== 'MemberExpression' ||
    member.computed ||
    member.object.type !== 'Identifier' ||
    member.object.name !== local ||
    member.property.type !== 'Identifier'
  ) {
    return undefined;
  }
  return { name: member.property.name, node: argument };
};

const entries = ({ array, local }: ParsedConfig): (UselabEntry | undefined)[] =>
  array.elements.map((element) => uselabEntry(element, local));

type IgnoresEntry = { index: number; node: ASTNode; legacy: boolean };

/** Finds the `globalIgnores(...)` entry, or else the legacy `...configs.ignores(...)` one. */
const ignoresEntry = (parsed: ParsedConfig): IgnoresEntry | undefined => {
  const { elements } = parsed.array;
  const index = elements.findIndex(
    (element) =>
      element?.type === 'CallExpression' &&
      element.callee.type === 'Identifier' &&
      element.callee.name === parsed.ignoresLocal,
  );
  const element = elements[index];
  if (element) {
    return { index, node: element, legacy: false };
  }
  const legacyIndex = entries(parsed).findIndex((entry) => entry?.name === 'ignores');
  const legacy = entries(parsed)[legacyIndex];
  return legacy ? { index: legacyIndex, node: legacy.node, legacy: true } : undefined;
};

const stringValue = (node: ASTNode): string | undefined =>
  node.type === 'StringLiteral' ? node.value : undefined;

const stringArray = (node: ASTNode): string[] | undefined => {
  if (node.type !== 'ArrayExpression') {
    return undefined;
  }
  const values = node.elements.map((element) => (element ? stringValue(element) : undefined));
  return values.every((value) => value !== undefined) ? values : undefined;
};

type ObjectNode = Extract<ASTNode, { type: 'ObjectExpression' }>;
type PropertyNode = ObjectNode['properties'][number];

/** Options of older versions; the app / features / support layout is no longer configurable. */
export const REMOVED_BOUNDARIES_OPTIONS = ['elements', 'policies', 'files', 'include', 'rootPath'];

type BoundariesOption =
  | { kind: 'value'; key: keyof BoundariesAnswers; value: string | string[] }
  | { kind: 'removed'; key: string };

const propertyKey = (property: PropertyNode): string | undefined => {
  if (property.type !== 'ObjectProperty' || property.computed) {
    return undefined;
  }
  return property.key.type === 'Identifier' ? property.key.name : stringValue(property.key);
};

/** Reads one literal `srcDirs` / `tsconfig` option or a removed one; undefined for anything else. */
const readBoundariesOption = (property: PropertyNode): BoundariesOption | undefined => {
  const key = propertyKey(property);
  if (key === undefined || property.type !== 'ObjectProperty') {
    return undefined;
  }
  if (REMOVED_BOUNDARIES_OPTIONS.includes(key)) {
    return { kind: 'removed', key };
  }
  const value = stringValue(property.value) ?? stringArray(property.value);
  if (key === 'tsconfig' && value !== undefined) {
    return { kind: 'value', key, value };
  }
  return key === 'srcDirs' && Array.isArray(value) ? { kind: 'value', key, value } : undefined;
};

type ReadBoundaries = { answers: BoundariesAnswers; removedOptions: string[] };

/** Reads `boundaries({ srcDirs, tsconfig })` when these options are literals. */
const readBoundaries = (node: ASTNode): ReadBoundaries | undefined => {
  if (node.type !== 'CallExpression' || node.arguments.length > 1) {
    return undefined;
  }
  const [options] = node.arguments;
  if (options === undefined) {
    return { answers: {}, removedOptions: [] };
  }
  if (options.type !== 'ObjectExpression') {
    return undefined;
  }
  const found = options.properties.map(readBoundariesOption);
  if (!found.every((entry) => entry !== undefined)) {
    return undefined;
  }
  const answers: BoundariesAnswers = {};
  const removedOptions: string[] = [];
  for (const option of found) {
    if (option.kind === 'removed') {
      removedOptions.push(option.key);
    } else if (option.key === 'srcDirs') {
      answers.srcDirs = [option.value].flat();
    } else {
      answers.tsconfig = option.value;
    }
  }
  return { answers, removedOptions };
};

type ReadJavascript = { answers: JavaScriptAnswers; legacy: boolean };

/** Reads `javascript`, `javascript()` and `javascript({ testFiles })` with a literal array. */
const readJavascript = (node: ASTNode): ReadJavascript | undefined => {
  if (node.type === 'MemberExpression') {
    return { answers: {}, legacy: true };
  }
  if (node.type !== 'CallExpression' || node.arguments.length > 1) {
    return undefined;
  }
  const [options] = node.arguments;
  if (options === undefined) {
    return { answers: {}, legacy: false };
  }
  if (options.type !== 'ObjectExpression') {
    return undefined;
  }
  const answers: JavaScriptAnswers = {};
  for (const property of options.properties) {
    const value = property.type === 'ObjectProperty' ? stringArray(property.value) : undefined;
    if (propertyKey(property) !== 'testFiles' || value === undefined) {
      return undefined;
    }
    answers.testFiles = value;
  }
  return { answers, legacy: false };
};

type PresetEntries = { javascript?: UselabEntry; boundaries?: UselabEntry };

const ALL_FILES: IgnoresAnswers = { mode: 'all', globs: [] };

/** Former defaults, read like the current ones and dropped when the entry is rewritten. */
const LEGACY_DEFAULT_IGNORES: readonly string[] = ['**/coverage/**'];

const isDefaultIgnore = (pattern: string): boolean =>
  DEFAULT_IGNORES.includes(pattern) || LEGACY_DEFAULT_IGNORES.includes(pattern);

/**
 * Reads opt-in patterns (`'**\/*', '!**\/*\/', '!src/**', 'src/legacy/**'`) back to their globs:
 * the negated patterns are the linted globs, the patterns after them the skipped `!globs`.
 */
const readOptIn = (patterns: string[]): IgnoresAnswers | undefined => {
  const rest = patterns.filter(
    (pattern) => !IGNORE_EVERYTHING.includes(pattern) && pattern !== KEEP_TOOLING_FILES,
  );
  const firstSkipped = rest.findIndex((pattern) => !pattern.startsWith('!'));
  const linted = firstSkipped === -1 ? rest : rest.slice(0, firstSkipped);
  const skipped = firstSkipped === -1 ? [] : rest.slice(firstSkipped);
  if (linted.length === 0 || skipped.some((pattern) => pattern.startsWith('!'))) {
    return undefined;
  }
  return {
    mode: 'only',
    globs: [...linted.map((pattern) => pattern.slice(1)), ...skipped.map((glob) => `!${glob}`)],
  };
};

/** Maps the scope patterns (without the defaults) to the lint scope. */
const readScope = (patterns: string[]): IgnoresAnswers | undefined => {
  if (patterns.length === 0) {
    return ALL_FILES;
  }
  if (IGNORE_EVERYTHING.every((pattern) => patterns.includes(pattern))) {
    return readOptIn(patterns);
  }
  return { mode: 'exclude', globs: patterns };
};

/** Reads the legacy `ignores()` / `ignores([...])` with literal patterns into the lint scope. */
const readLegacyIgnores = (node: ASTNode): IgnoresAnswers | undefined => {
  if (node.type !== 'CallExpression' || node.arguments.length > 1) {
    return undefined;
  }
  const [argument] = node.arguments;
  if (argument === undefined) {
    return ALL_FILES;
  }
  const patterns = stringArray(argument);
  return patterns === undefined ? undefined : readScope(patterns);
};

/** Reads `globalIgnores([...])` (and an optional name) with literal patterns into the lint scope. */
const readGlobalIgnores = (node: ASTNode): IgnoresAnswers | undefined => {
  if (node.type !== 'CallExpression' || node.arguments.length === 0 || node.arguments.length > 2) {
    return undefined;
  }
  const [argument] = node.arguments;
  const patterns = argument ? stringArray(argument) : undefined;
  return patterns === undefined
    ? undefined
    : readScope(patterns.filter((pattern) => !isDefaultIgnore(pattern)));
};

const readIgnoresOptions = (entry: IgnoresEntry | undefined) => {
  if (!entry) {
    return { ignores: ALL_FILES, ignoresEditable: true, ignoresLegacy: false };
  }
  const read = entry.legacy ? readLegacyIgnores(entry.node) : readGlobalIgnores(entry.node);
  return { ignores: read, ignoresEditable: read !== undefined, ignoresLegacy: entry.legacy };
};

const readJavascriptOptions = ({ javascript }: PresetEntries) => {
  const read = javascript ? readJavascript(javascript.node) : undefined;
  return {
    javascript: read?.answers,
    javascriptEditable: !javascript || read !== undefined,
    javascriptLegacy: read?.legacy ?? false,
  };
};

const readBoundariesOptions = ({ boundaries }: PresetEntries) => {
  const read = boundaries ? readBoundaries(boundaries.node) : undefined;
  return {
    boundaries: read?.answers,
    boundariesEditable: !boundaries || read !== undefined,
    boundariesRemovedOptions: read?.removedOptions ?? [],
  };
};

/** Reads the presets of an existing `@uselab/linting` ESLint config. */
export const readEslintConfig = (text: string): ExistingConfig | undefined => {
  const parsed = parseConfig(text);
  if (!parsed) {
    return undefined;
  }
  const found = entries(parsed).filter((entry) => entry !== undefined);
  const presetEntries: PresetEntries = {
    javascript: found.find(({ name }) => name === 'javascript'),
    boundaries: found.find(({ name }) => name === 'boundaries'),
  };
  return {
    presets: PRESET_ORDER.filter((preset) => found.some(({ name }) => name === preset)),
    ...readJavascriptOptions(presetEntries),
    ...readBoundariesOptions(presetEntries),
    ...readIgnoresOptions(ignoresEntry(parsed)),
  };
};

const arrayElement = (expression: string): NonNullable<ElementNode> => {
  const node = builders.raw(`[${expression}]`).$ast;
  const [element] = node.type === 'ArrayExpression' ? node.elements : [];
  if (!element) {
    throw new Error(`Can't build an array element for ${expression}`);
  }
  return element;
};

const spreadElement = (expression: string): NonNullable<ElementNode> =>
  arrayElement(`...${expression}`);

const orderIndex = (name: string): number =>
  isPreset(name) ? PRESET_ORDER.indexOf(name) : Number.NEGATIVE_INFINITY;

/** Index to insert a preset at: before the first later preset, else after the last uselab entry. */
const insertIndex = (parsed: ParsedConfig, preset: PresetId): number => {
  const current = entries(parsed);
  const later = current.findIndex(
    (entry) => entry !== undefined && orderIndex(entry.name) > orderIndex(preset),
  );
  if (later !== -1) {
    return later;
  }
  const last = current.findLastIndex((entry) => entry !== undefined);
  return last === -1 ? parsed.array.elements.length : last + 1;
};

const sameAnswers = (a: BoundariesAnswers = {}, b: BoundariesAnswers = {}): boolean =>
  presetExpression('boundaries', { presets: [], boundaries: a }) ===
  presetExpression('boundaries', { presets: [], boundaries: b });

const sameJavascript = (a: JavaScriptAnswers = {}, b: JavaScriptAnswers = {}): boolean =>
  presetExpression('javascript', { presets: [], javascript: a }) ===
  presetExpression('javascript', { presets: [], javascript: b });

const replaceEntry = (parsed: ParsedConfig, preset: PresetId, answers: InitAnswers): boolean => {
  const index = entries(parsed).findIndex((entry) => entry?.name === preset);
  if (index === -1) {
    return false;
  }
  parsed.array.elements.splice(
    index,
    1,
    spreadElement(presetExpression(preset, answers, parsed.local)),
  );
  return true;
};

/** Rewrites `javascript` to the call form and its options when they changed and are literals. */
const updateJavascript = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): boolean => {
  if (
    !answers.presets.includes('javascript') ||
    !existing.javascriptEditable ||
    (!existing.javascriptLegacy && sameJavascript(existing.javascript, answers.javascript))
  ) {
    return false;
  }
  return replaceEntry(parsed, 'javascript', answers);
};

const removePresets = (parsed: ParsedConfig, presets: PresetId[]): void => {
  const { elements } = parsed.array;
  const remove = elements
    .map((element, index) => ({ entry: uselabEntry(element, parsed.local), index }))
    .filter(({ entry }) => entry && isPreset(entry.name) && presets.includes(entry.name))
    .reverse();
  for (const { index } of remove) {
    elements.splice(index, 1);
  }
};

const addPresets = (parsed: ParsedConfig, presets: PresetId[], answers: InitAnswers): void => {
  for (const preset of presets) {
    parsed.array.elements.splice(
      insertIndex(parsed, preset),
      0,
      spreadElement(presetExpression(preset, answers, parsed.local)),
    );
  }
};

/** Rewrites the `boundaries()` options when they changed (or have removed options) and are literals. */
const updateBoundaries = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): boolean => {
  const index = entries(parsed).findIndex((entry) => entry?.name === 'boundaries');
  if (
    index === -1 ||
    !answers.presets.includes('boundaries') ||
    !existing.boundariesEditable ||
    (existing.boundariesRemovedOptions.length === 0 &&
      sameAnswers(existing.boundaries, answers.boundaries))
  ) {
    return false;
  }
  return replaceEntry(parsed, 'boundaries', answers);
};

/**
 * Prints the updated config. The array is printed with one entry per line: recast only measures
 * its first line, so a multi-line entry such as `globalIgnores([` would otherwise collapse it.
 * A missing `globalIgnores` import is added in a second pass, so it keeps the default format.
 */
const printConfig = (parsed: ParsedConfig, addIgnoresImport: boolean): string => {
  const code = generateCode(parsed.mod, { format: { wrapColumn: 0 } }).code;
  if (!addIgnoresImport) {
    return code;
  }
  const mod = parseModule(code);
  mod.imports.$prepend({
    from: GLOBAL_IGNORES_MODULE,
    imported: GLOBAL_IGNORES,
    local: GLOBAL_IGNORES,
  });
  return generateCode(mod).code;
};

/**
 * Rewrites the `globalIgnores()` entry when the lint scope changed and its patterns are literals,
 * migrates the legacy `...configs.ignores()` to it, or inserts it at the top when it's missing and
 * not all files are linted.
 */
const updateIgnores = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): boolean => {
  const scope = answers.ignores ?? (existing.ignoresLegacy ? existing.ignores : undefined);
  if (
    scope === undefined ||
    !existing.ignoresEditable ||
    (!existing.ignoresLegacy && ignoresExpression(existing.ignores) === ignoresExpression(scope))
  ) {
    return false;
  }
  const entry = ignoresEntry(parsed);
  const element = arrayElement(ignoresExpression(scope, parsed.ignoresLocal ?? GLOBAL_IGNORES));
  if (entry) {
    parsed.array.elements.splice(entry.index, 1, element);
  } else {
    parsed.array.elements.unshift(element);
  }
  return true;
};

/** Prints the updated config, adding the `globalIgnores` import when the entry was written without one. */
const printUpdated = (parsed: ParsedConfig, ignoresUpdated: boolean): string =>
  printConfig(parsed, ignoresUpdated && parsed.ignoresLocal === undefined);

/**
 * Rewrites only the `globalIgnores()` lint scope of an existing `@uselab/linting` ESLint config.
 * Returns the (possibly unchanged) code, or undefined for other configs or non-literal ignores.
 */
export const updateEslintIgnores = (
  text: string,
  ignores: IgnoresAnswers,
): { code: string; updated: boolean } | undefined => {
  const existing = readEslintConfig(text);
  const parsed = parseConfig(text);
  if (!existing?.ignoresEditable || !parsed) {
    return undefined;
  }
  const updated = updateIgnores(parsed, existing, { presets: existing.presets, ignores });
  return { code: updated ? printUpdated(parsed, true) : text, updated };
};

/**
 * Updates an existing `@uselab/linting` ESLint config to the selected presets: adds the missing
 * ones in the canonical order, removes deselected ones, rewrites the `javascript()` and
 * `boundaries()` options and the `globalIgnores()` lint scope (migrating `configs.ignores()`).
 * Other entries (custom rules, other plugins) are kept.
 * Returns undefined for other configs.
 */
export const updateEslintConfig = (
  text: string,
  answers: InitAnswers,
): ConfigUpdate | undefined => {
  const existing = readEslintConfig(text);
  const parsed = parseConfig(text);
  if (!existing || !parsed) {
    return undefined;
  }
  const removed = existing.presets.filter((preset) => !answers.presets.includes(preset));
  const added = PRESET_ORDER.filter(
    (preset) => answers.presets.includes(preset) && !existing.presets.includes(preset),
  );
  removePresets(parsed, removed);
  const javascriptUpdated = updateJavascript(parsed, existing, answers);
  const boundariesUpdated = updateBoundaries(parsed, existing, answers);
  addPresets(parsed, added, answers);
  const ignoresUpdated = updateIgnores(parsed, existing, answers);
  const changed =
    added.length > 0 ||
    removed.length > 0 ||
    javascriptUpdated ||
    boundariesUpdated ||
    ignoresUpdated;
  return {
    code: changed ? printUpdated(parsed, ignoresUpdated) : text,
    added,
    removed,
    javascriptUpdated,
    boundariesUpdated,
    ignoresUpdated,
    ignoresMigrated: ignoresUpdated && existing.ignoresLegacy,
    boundariesRemovedOptions: boundariesUpdated ? existing.boundariesRemovedOptions : [],
  };
};
