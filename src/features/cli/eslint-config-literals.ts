import type { ASTNode } from 'magicast';

type ObjectNode = Extract<ASTNode, { type: 'ObjectExpression' }>;
export type PropertyNode = ObjectNode['properties'][number];

export const stringValue = (node: ASTNode): string | undefined =>
  node.type === 'StringLiteral' ? node.value : undefined;

export const stringArray = (node: ASTNode): string[] | undefined => {
  if (node.type !== 'ArrayExpression') {
    return undefined;
  }
  const values = node.elements.map((element) => (element ? stringValue(element) : undefined));
  return values.every((value) => value !== undefined) ? values : undefined;
};

export const propertyKey = (property: PropertyNode): string | undefined => {
  if (property.type !== 'ObjectProperty' || property.computed) {
    return undefined;
  }
  return property.key.type === 'Identifier' ? property.key.name : stringValue(property.key);
};

type ReadGlobsCall = { globs?: string[] };

/** Reads `name()` and `name({ [key]: [...] })` with a literal array. Undefined for anything else. */
export const readGlobsCall = (node: ASTNode, key: string): ReadGlobsCall | undefined => {
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
  let globs: string[] | undefined;
  for (const property of options.properties) {
    const value = property.type === 'ObjectProperty' ? stringArray(property.value) : undefined;
    if (propertyKey(property) !== key || value === undefined) {
      return undefined;
    }
    globs = value;
  }
  return { globs };
};
