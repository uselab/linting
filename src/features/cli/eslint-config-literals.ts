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
