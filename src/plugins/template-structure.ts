import type { ESLint } from 'eslint';
import type { AST } from 'vue-eslint-parser';

type VueTemplateChild = AST.VElement | AST.VText | AST.VExpressionContainer;

type TemplateVisitor = {
  VElement?: (node: AST.VElement) => void;
};

type DefineTemplateBodyVisitor = (templateVisitor: TemplateVisitor) => TemplateVisitor;

const isDefineTemplateBodyVisitor = (value: unknown): value is DefineTemplateBodyVisitor =>
  typeof value === 'function';

const getDefineTemplateBodyVisitor = (
  sourceCode: unknown,
): DefineTemplateBodyVisitor | undefined => {
  if (!sourceCode || typeof sourceCode !== 'object') {
    return;
  }

  const parserServices: unknown = Reflect.get(sourceCode, 'parserServices');
  if (!parserServices || typeof parserServices !== 'object') {
    return;
  }

  const defineTemplateBodyVisitor: unknown = Reflect.get(
    parserServices,
    'defineTemplateBodyVisitor',
  );
  if (!isDefineTemplateBodyVisitor(defineTemplateBodyVisitor)) {
    return;
  }

  return defineTemplateBodyVisitor;
};

const isConditionalDirective = (
  attribute: AST.VAttribute | AST.VDirective | undefined,
): attribute is AST.VDirective => {
  if (!attribute || attribute.directive !== true) {
    return false;
  }

  const directiveName = attribute.key?.name?.name;
  return typeof directiveName === 'string' && ['if', 'else-if', 'else'].includes(directiveName);
};

const isWhitespaceText = (child: VueTemplateChild): boolean =>
  child.type === 'VText' && child.value.trim() === '';

const isConditionalWrapperWithSingleElementChild = (node: AST.VElement): boolean => {
  if (node.rawName !== 'div' && node.rawName !== 'span') {
    return false;
  }

  const firstAttribute = node.startTag?.attributes?.[0];
  if (!isConditionalDirective(firstAttribute)) {
    return false;
  }

  const meaningfulChildren = (node.children ?? []).filter(
    (child: VueTemplateChild) => !isWhitespaceText(child),
  );
  if (meaningfulChildren.length !== 1) {
    return false;
  }

  return meaningfulChildren[0]?.type === 'VElement';
};

/**
 * Custom Vue template rules.
 * - `no-redundant-conditional-wrapper`: disallow <div>/<span> wrappers whose only purpose is to
 *   carry a v-if/v-else-if/v-else around exactly one element child.
 */
export const templateStructurePlugin: ESLint.Plugin = {
  meta: { name: 'uselab-template-structure' },
  rules: {
    'no-redundant-conditional-wrapper': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Disallow redundant conditional div/span wrappers when there is exactly one meaningful element child',
        },
        schema: [],
        messages: {
          redundantWrapper:
            'Avoid redundant wrapper <div>/<span> for conditional rendering when there is exactly one meaningful element child. Move the v-if/v-else-if/v-else to the child node. If the wrapper is intentional, add an explicit eslint exception comment.',
        },
      },
      create: (context) => {
        const templateVisitor = {
          VElement: (node: AST.VElement) => {
            if (!isConditionalWrapperWithSingleElementChild(node)) {
              return;
            }

            context.report({
              // vue-eslint-parser nodes are ESTree-compatible but typed separately.
              loc: node.loc,
              messageId: 'redundantWrapper',
            });
          },
        };

        const defineTemplateBodyVisitor = getDefineTemplateBodyVisitor(context.sourceCode);
        return defineTemplateBodyVisitor ? defineTemplateBodyVisitor(templateVisitor) : {};
      },
    },
  },
};
