import type { ASTNode } from 'magicast';
import { isQueryLibraryId } from '../../support/query-libraries';
import { propertyKey, stringArray, stringValue, type PropertyNode } from './eslint-config-literals';
import { presetExpression, type InitAnswers, type QueryAnswers } from './generate';

const readOption = (property: PropertyNode): QueryAnswers | undefined => {
  if (property.type !== 'ObjectProperty') {
    return undefined;
  }
  const key = propertyKey(property);
  const text = stringValue(property.value);
  if (key === 'library' && text !== undefined && isQueryLibraryId(text)) {
    return { library: text };
  }
  const allow = stringArray(property.value);
  return key === 'allow' && allow !== undefined ? { allow } : undefined;
};

/** Reads `query()` and `query({ library, allow })` with literal options; undefined for anything else. */
export const readQuery = (node: ASTNode): QueryAnswers | undefined => {
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
  const found = options.properties.map(readOption);
  return found.every((answers) => answers !== undefined) ? Object.assign({}, ...found) : undefined;
};

/** The `query` / `queryEditable` fields of an existing config. */
export const readQueryOptions = (entry: { node: ASTNode } | undefined) => {
  const read = entry ? readQuery(entry.node) : undefined;
  return { query: read, queryEditable: !entry || read !== undefined };
};

/** Whether the `query()` entry should be rewritten: selected, literal options and changed. */
export const queryNeedsUpdate = (
  existing: { query?: QueryAnswers; queryEditable: boolean },
  answers: InitAnswers,
  local: string,
): boolean =>
  answers.presets.includes('query') &&
  existing.queryEditable &&
  presetExpression('query', answers, local) !==
    presetExpression('query', { presets: [], query: existing.query }, local);
