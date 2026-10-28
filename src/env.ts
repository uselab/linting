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
  {
    selector: 'ClassDeclaration',
    message: 'Use arrow functions or factory functions instead of classes',
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
