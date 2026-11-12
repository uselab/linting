import { builders, generateCode, parseModule, type ASTNode, type ProxifiedModule } from 'magicast';
import { ALL_FILES, readGlobalIgnores } from './eslint-config-ignores';
import { queryNeedsUpdate, readQueryOptions } from './eslint-config-query';
import {
  propertyKey,
  readGlobsCall,
  stringArray,
  stringValue,
  type PropertyNode,
} from './eslint-config-literals';
import {
  GLOBAL_IGNORES,
  GLOBAL_IGNORES_MODULE,
  GLOBALS_OPTION_KEYS,
  globsOptions,
  ignoresExpression,
  LINTING_PACKAGE,
  PRESET_ORDER,
  presetExport,
  presetExpression,
  type BoundariesAnswers,
  type EnvironmentAnswers,
  type GlobalsPreset,
  type IgnoresAnswers,
  type InitAnswers,
  type JavaScriptAnswers,
  type PresetId,
  type QueryAnswers,
} from './generate';

type ArrayNode = Extract<ASTNode, { type: 'ArrayExpression' }>;
type ElementNode = ArrayNode['elements'][number];

type UselabEntry = { name: PresetId; node: ASTNode };

type ParsedConfig = {
  mod: ProxifiedModule;
  /** Local names of the presets imported from `@uselab/linting`. */
  locals: Partial<Record<PresetId, string>>;
  array: ArrayNode;
  /** Local name of `globalIgnores` imported from `eslint/config`, if imported. */
  ignoresLocal?: string;
};

export type ExistingConfig = {
  presets: PresetId[];
  javascript?: JavaScriptAnswers;
  /** False when the `javascript()` options aren't plain literals and can't be rewritten. */
  javascriptEditable: boolean;
  boundaries?: BoundariesAnswers;
  /** False when the `boundaries()` options aren't plain literals and can't be rewritten. */
  boundariesEditable: boolean;
  query?: QueryAnswers;
  /** False when the `query()` options aren't plain literals and can't be rewritten. */
  queryEditable: boolean;
  /** The `browser({ files })` globs, if any. */
  browserFiles?: string[];
  /** False when the `browser()` options aren't plain literals and can't be rewritten. */
  browserEditable: boolean;
  /** The `node({ ignores })` globs, if any. */
  nodeIgnores?: string[];
  /** False when the `node()` options aren't plain literals and can't be rewritten. */
  nodeEditable: boolean;
  /** Project type: browser when the browser preset is used, node for only the node preset. */
  environment?: EnvironmentAnswers;
  /** Lint scope of the `globalIgnores()` entry; `all` when there is none. */
  ignores?: IgnoresAnswers;
  /** False when the `globalIgnores()` patterns aren't plain literals or not a recognised scope. */
  ignoresEditable: boolean;
};

export type ConfigUpdate = {
  code: string;
  added: PresetId[];
  removed: PresetId[];
  javascriptUpdated: boolean;
  boundariesUpdated: boolean;
  queryUpdated: boolean;
  /** The `browser()` / `node()` entries whose options were rewritten. */
  globalsUpdated: GlobalsPreset[];
  ignoresUpdated: boolean;
};

/** Finds the config array of `export default [...]` or `export default defineConfig([...])`. */
const configArray = (node: ASTNode): ArrayNode | undefined => {
  if (node.type === 'ArrayExpression') {
    return node;
  }
  const [first] = node.type === 'CallExpression' ? node.arguments : [];
  return first?.type === 'ArrayExpression' ? first : undefined;
};

/** Parses an ESLint flat config that spreads presets imported from `@uselab/linting`. */
const parseConfig = (text: string): ParsedConfig | undefined => {
  try {
    const mod = parseModule(text);
    const imports = mod.imports.$items.filter(({ from }) => from === LINTING_PACKAGE);
    const locals: ParsedConfig['locals'] = {};
    for (const preset of PRESET_ORDER) {
      const item = imports.find(({ imported }) => imported === presetExport(preset));
      if (item) {
        locals[preset] = item.local;
      }
    }
    const array = configArray(mod.exports.default.$ast);
    const ignoresLocal = mod.imports.$items.find(
      ({ from, imported }) => from === GLOBAL_IGNORES_MODULE && imported === GLOBAL_IGNORES,
    )?.local;
    return imports.length > 0 && array ? { mod, locals, array, ignoresLocal } : undefined;
  } catch {
    return undefined;
  }
};

const localName = ({ locals }: ParsedConfig, preset: PresetId): string =>
  locals[preset] ?? presetExport(preset);

/** Returns the preset for `...preset` and `...preset(...)` spreads of an imported preset. */
const uselabEntry = (element: ElementNode, parsed: ParsedConfig): UselabEntry | undefined => {
  if (element?.type !== 'SpreadElement') {
    return undefined;
  }
  const { argument } = element;
  const callee = argument.type === 'CallExpression' ? argument.callee : argument;
  if (callee.type !== 'Identifier') {
    return undefined;
  }
  const name = PRESET_ORDER.find((preset) => parsed.locals[preset] === callee.name);
  return name && { name, node: argument };
};

const entries = (parsed: ParsedConfig): (UselabEntry | undefined)[] =>
  parsed.array.elements.map((element) => uselabEntry(element, parsed));

type IgnoresEntry = { index: number; node: ASTNode };

/** Finds the `globalIgnores(...)` entry. */
const ignoresEntry = (parsed: ParsedConfig): IgnoresEntry | undefined => {
  const { elements } = parsed.array;
  const index = elements.findIndex(
    (element) =>
      element?.type === 'CallExpression' &&
      element.callee.type === 'Identifier' &&
      element.callee.name === parsed.ignoresLocal,
  );
  const element = elements[index];
  return element ? { index, node: element } : undefined;
};

/** Reads one literal `srcDirs` / `tsconfig` option; undefined for anything else. */
const readBoundariesOption = (
  property: PropertyNode,
): { key: keyof BoundariesAnswers; value: string | string[] } | undefined => {
  const key = propertyKey(property);
  if (key === undefined || property.type !== 'ObjectProperty') {
    return undefined;
  }
  const value = stringValue(property.value) ?? stringArray(property.value);
  if (key === 'tsconfig' && value !== undefined) {
    return { key, value };
  }
  return key === 'srcDirs' && Array.isArray(value) ? { key, value } : undefined;
};

/** Reads `boundaries({ srcDirs, tsconfig })` when these options are literals. */
const readBoundaries = (node: ASTNode): BoundariesAnswers | undefined => {
  if (node.type !== 'CallExpression' || node.arguments.length > 1) {
    return undefined;
  }
  const [options] = node.arguments;
  if (options === undefined) {
    return {};
  }
  if (options.type !== 'ObjectExpression') {
    return undefined;
  }
  const found = options.properties.map(readBoundariesOption);
  if (!found.every((entry) => entry !== undefined)) {
    return undefined;
  }
  const answers: BoundariesAnswers = {};
  for (const option of found) {
    if (option.key === 'srcDirs') {
      answers.srcDirs = [option.value].flat();
    } else {
      answers.tsconfig = option.value;
    }
  }
  return answers;
};

/** Reads `javascript()` and `javascript({ testFiles })` with a literal array. */
const readJavascript = (node: ASTNode): JavaScriptAnswers | undefined => {
  const read = readGlobsCall(node, 'testFiles');
  return read && { testFiles: read.globs ?? [] };
};

type PresetEntries = {
  javascript?: UselabEntry;
  boundaries?: UselabEntry;
  query?: UselabEntry;
  browser?: UselabEntry;
  node?: UselabEntry;
};

const readIgnoresOptions = (entry: ASTNode | undefined) => {
  if (!entry) {
    return { ignores: ALL_FILES, ignoresEditable: true };
  }
  const read = readGlobalIgnores(entry);
  return { ignores: read, ignoresEditable: read !== undefined };
};

const readJavascriptOptions = ({ javascript }: PresetEntries) => {
  const read = javascript ? readJavascript(javascript.node) : undefined;
  return {
    javascript: read,
    javascriptEditable: !javascript || read !== undefined,
  };
};

const readBoundariesOptions = ({ boundaries }: PresetEntries) => {
  const read = boundaries ? readBoundaries(boundaries.node) : undefined;
  return { boundaries: read, boundariesEditable: !boundaries || read !== undefined };
};

const readGlobalsOptions = (entries: PresetEntries) => {
  const read = (preset: GlobalsPreset) => {
    const entry = entries[preset];
    const result = entry ? readGlobsCall(entry.node, GLOBALS_OPTION_KEYS[preset]) : undefined;
    return { globs: result?.globs, editable: !entry || result !== undefined };
  };
  const browser = read('browser');
  const node = read('node');
  return {
    browserFiles: browser.globs,
    browserEditable: browser.editable,
    nodeIgnores: node.globs,
    nodeEditable: node.editable,
  };
};

/** The project type of the existing presets; the browser globs fall back to the node ignores. */
const readEnvironment = (
  presets: PresetId[],
  globals: ReturnType<typeof readGlobalsOptions>,
): EnvironmentAnswers | undefined => {
  if (presets.includes('browser')) {
    return { type: 'browser', browserFiles: globals.browserFiles ?? globals.nodeIgnores ?? [] };
  }
  return presets.includes('node') ? { type: 'node', browserFiles: [] } : undefined;
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
    query: found.find(({ name }) => name === 'query'),
    browser: found.find(({ name }) => name === 'browser'),
    node: found.find(({ name }) => name === 'node'),
  };
  const presets = PRESET_ORDER.filter((preset) => found.some(({ name }) => name === preset));
  const globals = readGlobalsOptions(presetEntries);
  return {
    presets,
    ...readJavascriptOptions(presetEntries),
    ...readBoundariesOptions(presetEntries),
    ...readQueryOptions(presetEntries.query),
    ...globals,
    environment: readEnvironment(presets, globals),
    ...readIgnoresOptions(ignoresEntry(parsed)?.node),
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

const orderIndex = (name: PresetId): number => PRESET_ORDER.indexOf(name);

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
    spreadElement(presetExpression(preset, answers, localName(parsed, preset))),
  );
  return true;
};

/** Rewrites the `javascript()` options when they changed and are literals. */
const updateJavascript = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): boolean => {
  if (
    !answers.presets.includes('javascript') ||
    !existing.javascriptEditable ||
    sameJavascript(existing.javascript, answers.javascript)
  ) {
    return false;
  }
  return replaceEntry(parsed, 'javascript', answers);
};

const removePresets = (parsed: ParsedConfig, presets: PresetId[]): void => {
  const { elements } = parsed.array;
  const remove = elements
    .map((element, index) => ({ entry: uselabEntry(element, parsed), index }))
    .filter(({ entry }) => entry && presets.includes(entry.name))
    .reverse();
  for (const { index } of remove) {
    elements.splice(index, 1);
  }
  for (const preset of presets) {
    const local = parsed.locals[preset];
    if (local !== undefined) {
      delete parsed.mod.imports[local]; // eslint-disable-line no-param-reassign -- magicast proxy
    }
  }
};

const addPresets = (parsed: ParsedConfig, presets: PresetId[], answers: InitAnswers): void => {
  for (const preset of presets) {
    parsed.array.elements.splice(
      insertIndex(parsed, preset),
      0,
      spreadElement(presetExpression(preset, answers, localName(parsed, preset))),
    );
    if (parsed.locals[preset] === undefined) {
      const name = presetExport(preset);
      parsed.mod.imports.$add({ from: LINTING_PACKAGE, imported: name, local: name });
    }
  }
};

/** Rewrites the `query()` options when they changed and are literals. */
const updateQuery = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): boolean => {
  return (
    queryNeedsUpdate(existing, answers, localName(parsed, 'query')) &&
    replaceEntry(parsed, 'query', answers)
  );
};

const GLOBALS_STATE = {
  browser: ['browserFiles', 'browserEditable'],
  node: ['nodeIgnores', 'nodeEditable'],
} as const;

/** Rewrites `browserPreset()` / `nodePreset()` globs when they changed. */
const updateGlobals = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): GlobalsPreset[] =>
  (['browser', 'node'] as const).filter((preset) => {
    const [globsKey, editableKey] = GLOBALS_STATE[preset];
    const local = localName(parsed, preset);
    const options = globsOptions(GLOBALS_OPTION_KEYS[preset], existing[globsKey]);
    const changed =
      answers.environment !== undefined &&
      `${local}(${options})` !== presetExpression(preset, answers, local);
    return (
      answers.presets.includes(preset) &&
      existing.presets.includes(preset) &&
      existing[editableKey] &&
      changed &&
      replaceEntry(parsed, preset, answers)
    );
  });

/** Rewrites the `boundaries()` options when they changed and are literals. */
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
    sameAnswers(existing.boundaries, answers.boundaries)
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
 * or inserts it at the top when it's missing and not all files are linted.
 */
const updateIgnores = (
  parsed: ParsedConfig,
  existing: ExistingConfig,
  answers: InitAnswers,
): boolean => {
  const scope = answers.ignores;
  if (
    scope === undefined ||
    !existing.ignoresEditable ||
    ignoresExpression(existing.ignores) === ignoresExpression(scope)
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
 * ones in the canonical order, removes deselected ones, rewrites the `javascript()`,
 * `boundaries()`, `browser()` and `node()` options and the `globalIgnores()` lint scope.
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
  const queryUpdated = updateQuery(parsed, existing, answers);
  const globalsUpdated = updateGlobals(parsed, existing, answers);
  addPresets(parsed, added, answers);
  const ignoresUpdated = updateIgnores(parsed, existing, answers);
  const changed = [
    added.length > 0,
    removed.length > 0,
    javascriptUpdated,
    boundariesUpdated,
    queryUpdated,
    globalsUpdated.length > 0,
    ignoresUpdated,
  ].includes(true);
  return {
    code: changed ? printUpdated(parsed, ignoresUpdated) : text,
    added,
    removed,
    javascriptUpdated,
    boundariesUpdated,
    queryUpdated,
    globalsUpdated,
    ignoresUpdated,
  };
};
