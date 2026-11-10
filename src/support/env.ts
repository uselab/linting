import type { Rules } from './shared';

/**
 * Development mode relaxes some rules (console, debugger, unused vars) from error to warn.
 * Dev mode: NODE_ENV=development, or not running in CI.
 */
export const isDevMode = (): boolean => process.env.NODE_ENV === 'development' || !process.env.CI;

export const devSeverity = (): 'warn' | 'error' => (isDevMode() ? 'warn' : 'error');

export const restrictedSyntaxEntries = [
  {
    selector: 'Literal[value=null]',
    message:
      'Use undefined instead of null. If null is required by backend-generated types/contracts, add a single-line eslint exception with a short reason.',
  },
];

const ATTRIBUTE_HINT =
  'Prefer reactive bindings. If unavoidable, document with an explicit eslint exception comment.';

/** `no-restricted-properties` entries of the browser preset; other presets repeat them (options replace each other). */
export const restrictedAttributeProperties = [
  {
    property: 'setAttribute',
    message: `Do not use setAttribute directly. ${ATTRIBUTE_HINT}`,
  },
  {
    property: 'removeAttribute',
    message: `Do not use removeAttribute directly. ${ATTRIBUTE_HINT}`,
  },
];

export const restrictedSyntax: Rules[string] = ['error', ...restrictedSyntaxEntries];

const BINDINGS_HINT = 'Bind classes declaratively in templates/JSX or static HTML.';

// no-restricted-properties only matches bare identifiers (`classList.add`), not `el.classList.add`,
// so classList mutation is restricted with selectors instead.
export const restrictedDomSyntaxEntries = ['add', 'remove', 'toggle'].map((method) => ({
  selector: `MemberExpression:matches([object.property.name='classList'], [object.name='classList'])[property.name='${method}']`,
  message: `Do not mutate classes via classList.${method}. ${BINDINGS_HINT}`,
}));
