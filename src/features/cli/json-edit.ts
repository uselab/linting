import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
  type Edit,
  type FormattingOptions,
  type JSONPath,
} from 'jsonc-parser';

/** Detects indentation and line endings of an existing JSON(C) document. */
export const detectFormatting = (text: string): FormattingOptions => {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ';
  return {
    insertSpaces: !indent.includes('\t'),
    tabSize: indent.includes('\t') ? 1 : indent.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
};

export type JsonChange = {
  path: JSONPath;
  value: unknown;
  /** Insert a new key after the last of these existing keys (or first) instead of alphabetically. */
  insertAfter?: string[];
  /** Insert a new key after all existing keys. */
  append?: boolean;
};

const alphabeticalIndex = (properties: string[], key: string): number => {
  const index = properties.findIndex((property) => key < property);
  return index === -1 ? properties.length : index;
};

const indexAfter = (properties: string[], keys: string[]): number =>
  Math.max(-1, ...keys.map((key) => properties.indexOf(key))) + 1;

/**
 * Applies changes to a JSON(C) document while preserving comments and formatting.
 * New object keys are inserted alphabetically unless `insertAfter` or `append` is given.
 */
export const applyJsonChanges = (text: string, changes: JsonChange[]): string => {
  const formattingOptions = detectFormatting(text);
  return changes.reduce((current, { path, value, insertAfter, append }) => {
    const key = String(path.at(-1));
    const insertionIndex = (properties: string[]): number => {
      if (append) {
        return properties.length;
      }
      return insertAfter ? indexAfter(properties, insertAfter) : alphabeticalIndex(properties, key);
    };
    const edits = modify(current, path, value, {
      formattingOptions,
      getInsertionIndex: insertionIndex,
    });
    return applyEdits(current, edits);
  }, text);
};

const removeArrayItem = (text: string, path: JSONPath, index: number): string => {
  const tree = parseTree(text);
  const array = tree && findNodeAtLocation(tree, path);
  const children = array?.type === 'array' ? (array.children ?? []) : [];
  const item = children[index];
  if (!item) {
    return text;
  }
  const previous = children[index - 1];
  const next = children[index + 1];
  // Remove the item with its leading separator, or with its trailing one when it is first.
  const start = previous ? previous.offset + previous.length : item.offset;
  const end = !previous && next ? next.offset : item.offset + item.length;
  const edit: Edit = { offset: start, length: end - start, content: '' };
  return applyEdits(text, [edit]);
};

/**
 * Removes items from an array, preserving comments and formatting. (jsonc-parser's `modify` cuts
 * off the closing bracket when removing the last item.)
 */
export const removeArrayItems = (text: string, path: JSONPath, indexes: number[]): string =>
  indexes
    .toSorted((left, right) => right - left)
    .reduce((current, index) => removeArrayItem(current, path, index), text);
