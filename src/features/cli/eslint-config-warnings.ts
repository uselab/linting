import { builders, type ASTNode, type ProxifiedModule } from 'magicast';
import { DISABLE_WARNINGS, LINTING_PACKAGE } from './generate';

type ArrayNode = Extract<ASTNode, { type: 'ArrayExpression' }>;

/** Whether the node is a call of the function with the given local name. */
export const isCallTo = (node: ASTNode, local: string | undefined): boolean =>
  local !== undefined &&
  node.type === 'CallExpression' &&
  node.callee.type === 'Identifier' &&
  node.callee.name === local;

type WrapTarget = {
  mod: ProxifiedModule;
  array: ArrayNode;
  /** Local name of `disableWarnings` imported from `@uselab/linting`, if imported. */
  local?: string;
  wrapped: boolean;
};

const defaultExport = (mod: ProxifiedModule) =>
  mod.$ast.type === 'Program'
    ? mod.$ast.body.find((node) => node.type === 'ExportDefaultDeclaration')
    : undefined;

/**
 * Wraps the config array in `disableWarnings([...])`, or unwraps it, to match `enabled`.
 * Returns whether the config changed.
 */
export const updateDisableWarnings = (
  { mod, array, local, wrapped }: WrapTarget,
  enabled: boolean | undefined,
): boolean => {
  const declaration = defaultExport(mod);
  if (declaration === undefined || enabled === undefined || enabled === wrapped) {
    return false;
  }
  if (!enabled) {
    declaration.declaration = array;
    if (local !== undefined) {
      delete mod.imports[local]; // eslint-disable-line no-param-reassign -- magicast proxy
    }
    return true;
  }
  const name = local ?? DISABLE_WARNINGS;
  const call = builders.raw(`${name}([])`).$ast;
  if (call.type !== 'CallExpression') {
    return false;
  }
  call.arguments = [array];
  declaration.declaration = call;
  if (local === undefined) {
    mod.imports.$add({ from: LINTING_PACKAGE, imported: DISABLE_WARNINGS, local: name });
  }
  return true;
};
