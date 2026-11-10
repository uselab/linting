import type { ESLint, Rule } from 'eslint';

type FileLocationOptions = { srcDir?: string };

const SRC_DIR_SCHEMA = [
  {
    type: 'object',
    properties: { srcDir: { type: 'string' } },
    additionalProperties: false,
  },
];

const LAYOUT_FOLDERS = new Set(['app', 'features', 'support']);

export const OUTSIDE_IMPORT_MESSAGE =
  'Imports from outside app/, features/ and support/ are not allowed. Move the file into one of them.';

const fileLocation: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require source files in a src folder to be in app/, features/ or support/.',
    },
    schema: SRC_DIR_SCHEMA,
    messages: {
      outsideLayout:
        'Files in {{ srcDir }}/ must be in app/, features/ or support/. Entry files such as main.ts belong in app/. Only declaration files (*.d.ts) are allowed directly in {{ srcDir }}/.',
    },
  },
  create: (context) => {
    const [options]: (FileLocationOptions | undefined)[] = context.options;
    return {
      Program: (node) => {
        context.report({
          node,
          messageId: 'outsideLayout',
          data: { srcDir: options?.srcDir ?? 'src' },
        });
      },
    };
  },
};

/**
 * The path inside the src dir of a path-style import (`/src/x`, `src/x`, or the full src dir
 * path, e.g. `apps/web/src/x`), or undefined for other imports.
 */
const pathInSrcDir = (source: string, srcDir: string): string | undefined => {
  const specifier = source.replace(/^\//, '');
  const folderName = srcDir.split('/').at(-1) ?? srcDir;
  const prefix = [srcDir, folderName].find(
    (candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`),
  );
  return prefix === undefined ? undefined : specifier.slice(prefix.length + 1);
};

type SourceNode = { type: string; value?: unknown };

/** The import path of `import`, `export ... from`, `import()` and `require()`. */
const importSource = (node: Rule.Node): SourceNode | undefined | null => {
  if (node.type === 'CallExpression') {
    const isRequire = node.callee.type === 'Identifier' && node.callee.name === 'require';
    return isRequire ? node.arguments[0] : undefined;
  }
  return 'source' in node ? node.source : undefined;
};

const importLocation: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow path-style imports (e.g. /src/main.css) of files outside app/, features/ and support/.',
    },
    schema: SRC_DIR_SCHEMA,
    messages: { outsideImport: OUTSIDE_IMPORT_MESSAGE },
  },
  create: (context) => {
    const [options]: (FileLocationOptions | undefined)[] = context.options;
    const srcDir = options?.srcDir ?? 'src';
    const check = (node: Rule.Node): void => {
      const source = importSource(node);
      if (source?.type !== 'Literal' || typeof source.value !== 'string') {
        return;
      }
      const inSrcDir = pathInSrcDir(source.value, srcDir);
      const [folder = ''] = inSrcDir?.split('/') ?? [];
      if (inSrcDir !== undefined && !LAYOUT_FOLDERS.has(folder)) {
        context.report({ node, messageId: 'outsideImport' });
      }
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
      CallExpression: check,
    };
  },
};

/** Rules for the fixed Uselab layout; the files to check are selected by the boundaries preset. */
export const layoutPlugin: ESLint.Plugin = {
  meta: { name: 'uselab-layout' },
  rules: { 'file-location': fileLocation, 'import-location': importLocation },
};
