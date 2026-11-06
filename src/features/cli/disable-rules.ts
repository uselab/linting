import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { builders, generateCode, parseModule, type ASTNode } from 'magicast';

/** Comment that marks the config entry with the rules disabled by `analyze`. */
export const DISABLE_RULES_COMMENT = 'disable-rules';

type ArrayNode = Extract<ASTNode, { type: 'ArrayExpression' }>;
type ElementNode = NonNullable<ArrayNode['elements'][number]>;
type ObjectNode = Extract<ASTNode, { type: 'ObjectExpression' }>;
/** Comments recast attached to the node (the parser's `leadingComments` aren't printed). */
const leadingComments = (node: object): string[] => {
  const comments: unknown = 'comments' in node ? node.comments : undefined;
  return Array.isArray(comments)
    ? comments.flatMap((comment: unknown) =>
        comment instanceof Object &&
        'value' in comment &&
        typeof comment.value === 'string' &&
        !('leading' in comment && comment.leading === false)
          ? [comment.value.trim()]
          : [],
      )
    : [];
};

/** Finds the config array of `export default [...]` or `export default defineConfig([...])`. */
const configArray = (node: ASTNode): ArrayNode | undefined => {
  if (node.type === 'ArrayExpression') {
    return node;
  }
  const [first] = node.type === 'CallExpression' ? node.arguments : [];
  return first?.type === 'ArrayExpression' ? first : undefined;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

const ruleKey = (ruleId: string): string => (IDENTIFIER.test(ruleId) ? ruleId : `'${ruleId}'`);

const offRules = (ruleIds: string[]): string =>
  ruleIds.map((ruleId) => `    ${ruleKey(ruleId)}: 'off',`).join('\n');

const rawElement = (expression: string): ElementNode => {
  const node = builders.raw(`[${expression}]`).$ast;
  const [element] = node.type === 'ArrayExpression' ? node.elements : [];
  if (!element) {
    throw new Error(`Can't build an array element for ${expression}`);
  }
  return element;
};

const hasMarker = (element: ElementNode | null): element is ObjectNode =>
  element?.type === 'ObjectExpression' && leadingComments(element).includes(DISABLE_RULES_COMMENT);

const keyName = (key: ASTNode): string | undefined => {
  if (key.type === 'Identifier') {
    return key.name;
  }
  return key.type === 'StringLiteral' ? key.value : undefined;
};

const rulesObject = (section: ObjectNode): ObjectNode | undefined => {
  const property = section.properties.find(
    (candidate) =>
      candidate.type === 'ObjectProperty' &&
      !candidate.computed &&
      keyName(candidate.key) === 'rules',
  );
  return property?.type === 'ObjectProperty' && property.value.type === 'ObjectExpression'
    ? property.value
    : undefined;
};

/** Sets the rules to `'off'` in the existing section. Returns false when it has no `rules` object. */
const mergeRules = (section: ObjectNode, ruleIds: string[]): boolean => {
  const rules = rulesObject(section);
  if (!rules) {
    return false;
  }
  const existing = new Set(
    rules.properties.map((property) =>
      property.type === 'ObjectProperty' ? keyName(property.key) : undefined,
    ),
  );
  const added = rawElement(`{\n${offRules(ruleIds.filter((ruleId) => !existing.has(ruleId)))}\n}`);
  if (added.type === 'ObjectExpression') {
    rules.properties.push(...added.properties);
  }
  return true;
};

const isPrettierSpread = (element: ElementNode | null): boolean => {
  if (element?.type !== 'SpreadElement') {
    return false;
  }
  const { argument } = element;
  const member = argument.type === 'CallExpression' ? argument.callee : argument;
  return (
    member.type === 'MemberExpression' &&
    !member.computed &&
    member.property.type === 'Identifier' &&
    member.property.name === 'prettier'
  );
};

/** The new section: `// disable-rules` followed by `{ rules: { 'rule': 'off' } }`. */
export const disableRulesSection = (ruleIds: string[]): string =>
  `// ${DISABLE_RULES_COMMENT}\n{\n  rules: {\n${offRules(ruleIds)}\n  },\n},`;

const insertSection = (array: ArrayNode, ruleIds: string[]): void => {
  const section = rawElement(`{\n  rules: {\n${offRules(ruleIds)}\n  },\n}`);
  Object.assign(section, {
    comments: [
      { type: 'CommentLine', value: ` ${DISABLE_RULES_COMMENT}`, leading: true, trailing: false },
    ],
  });
  const prettier = array.elements.findIndex((element) => isPrettierSpread(element));
  array.elements.splice(prettier === -1 ? array.elements.length : prettier, 0, section);
};

const parseArray = (text: string) => {
  try {
    const mod = parseModule(text);
    const array = configArray(mod.exports.default.$ast);
    return array ? { mod, array } : undefined;
  } catch {
    return;
  }
};

/**
 * Turns the rules off in the `// disable-rules` entry of an ESLint flat config, adding the entry
 * before `...configs.prettier` (or at the end) when it's missing. Returns undefined when the config
 * doesn't export an array (or `defineConfig([...])`), or its section has no `rules` object.
 */
export const disableRules = (text: string, ruleIds: string[]): string | undefined => {
  const parsed = parseArray(text);
  if (!parsed) {
    return undefined;
  }
  const section = parsed.array.elements.find((element) => hasMarker(element));
  if (section && hasMarker(section)) {
    if (!mergeRules(section, ruleIds)) {
      return undefined;
    }
  } else {
    insertSection(parsed.array, ruleIds);
  }
  const code = generateCode(parsed.mod, { format: { wrapColumn: 0, trailingComma: true } }).code;
  return text.endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code;
};

/** The ESLint config file ESLint uses for the project. */
export const findEslintConfigFile = async (projectDir: string): Promise<string | undefined> => {
  const { ESLint } = await import('eslint');
  return new ESLint({ cwd: projectDir }).findConfigFile();
};

/** Writes the rules to the `// disable-rules` entry. Returns whether the config was changed. */
export const writeDisabledRules = async (
  projectDir: string,
  ruleIds: string[],
): Promise<boolean> => {
  const configFile = await findEslintConfigFile(projectDir);
  const updated = configFile ? disableRules(readFileSync(configFile, 'utf8'), ruleIds) : undefined;
  if (!configFile || updated === undefined) {
    const name = configFile ? path.relative(projectDir, configFile) : 'the ESLint config';
    clack.log.warn(`Can't update ${name} automatically; disable the rules manually.`);
    clack.note(disableRulesSection(ruleIds), `Add before ...configs.prettier in ${name}`);
    return false;
  }
  writeFileSync(configFile, updated);
  clack.log.success(`Disabled ${ruleIds.join(', ')} in ${path.relative(projectDir, configFile)}.`);
  return true;
};
