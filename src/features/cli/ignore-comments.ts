import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Problem } from './analyze';

/** The comment syntax for the line: `//`, `{/* *\/}` inside JSX, or `<!-- -->` in a Vue template. */
export type CommentStyle = 'line' | 'jsx' | 'html';

type Context = CommentStyle | 'unsupported';

const DIRECTIVE = 'eslint-disable-next-line';

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
};

const VUE_SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  js: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
  ts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
};

const isTemplateText = (node: ts.Node): boolean =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node);

/** The deepest node that contains the position. */
const innermostNode = (source: ts.SourceFile, position: number): ts.Node => {
  let node: ts.Node = source;
  for (;;) {
    const child: ts.Node | undefined = ts.forEachChild(node, (candidate) =>
      candidate.getStart(source) <= position && position < candidate.end ? candidate : undefined,
    );
    if (!child) {
      return node;
    }
    node = child;
  }
};

/** Whether the node starts a child of a JSX element (or its closing tag). */
const jsxContext = (node: ts.Node, source: ts.SourceFile, position: number): Context => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
      const opening = ts.isJsxElement(parent) ? parent.openingElement : parent.openingFragment;
      if (current !== opening) {
        return 'jsx';
      }
      if (current.getStart(source) !== position) {
        return 'line';
      }
    } else if (
      ts.isJsxAttributes(parent) ||
      ts.isJsxExpression(parent) ||
      ts.isJsxSpreadAttribute(parent)
    ) {
      return 'line';
    }
    current = parent;
  }
  return 'line';
};

/** The comment style for each (0-based) line of a script. */
const scriptContexts = (text: string, kind: ts.ScriptKind) => {
  const source = ts.createSourceFile('file', text, ts.ScriptTarget.Latest, true, kind);
  const starts = source.getLineStarts();
  return (line: number): Context => {
    const start = starts[line] ?? text.length;
    const position = start + (/^[ \t]*/u.exec(text.slice(start))?.[0].length ?? 0);
    const node = innermostNode(source, position);
    if (isTemplateText(node) && node.getStart(source) < position) {
      return 'unsupported';
    }
    return ts.isJsxText(node) ? 'jsx' : jsxContext(node, source, position);
  };
};

type Block = { start: number; end: number; contexts: (line: number) => Context };

/** The `<script>` blocks of a Vue file: the lines between the tags (0-based, exclusive). */
const vueScriptBlocks = (lines: string[]): Block[] =>
  lines.flatMap((line, start) => {
    const open = /^<script\b([^>]*)>\s*$/u.exec(line);
    if (!open) {
      return [];
    }
    const end = lines.findIndex(
      (candidate, index) => index > start && /^<\/script>/u.test(candidate),
    );
    if (end === -1) {
      return [];
    }
    const lang = /\blang=["']?(\w+)/u.exec(open[1] ?? '')?.[1] ?? 'js';
    const contexts = scriptContexts(
      lines.slice(start + 1, end).join('\n'),
      VUE_SCRIPT_KINDS[lang] ?? ts.ScriptKind.JS,
    );
    return [{ start, end, contexts: (index: number) => contexts(index - start - 1) }];
  });

/** A function that gives the comment style of a (0-based) line, or undefined for other files. */
export const commentContexts = (
  file: string,
  lines: string[],
): ((line: number) => Context) | undefined => {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.vue') {
    const blocks = vueScriptBlocks(lines);
    return (line) => {
      const block = blocks.find(({ start, end }) => start < line && line < end);
      return block ? block.contexts(line) : 'html';
    };
  }
  const kind = SCRIPT_KINDS[extension];
  return kind === undefined ? undefined : scriptContexts(lines.join('\n'), kind);
};

const COMMENT_DELIMITERS: Record<CommentStyle, [string, string]> = {
  line: ['//', ''],
  jsx: ['{/*', '*/}'],
  html: ['<!--', '-->'],
};

const directiveComment = (
  [open, close]: [string, string],
  directive: string,
  ruleIds: string[],
): string => `${open} ${directive} ${ruleIds.join(', ')}${close ? ` ${close}` : ''}`;

/** E.g. `// eslint-disable-next-line rule-a, rule-b`. */
export const ignoreComment = (style: CommentStyle, ruleIds: string[]): string =>
  directiveComment(COMMENT_DELIMITERS[style], DIRECTIVE, ruleIds);

const EXISTING_DIRECTIVE =
  /^(?<indent>\s*)(?<open>\/\/|\/\*|\{\/\*|<!--)\s*eslint-disable-next-line\b(?<body>.*?)\s*(?<close>\*\/\}|\*\/|-->)?\s*$/u;

/** Adds the rules to an `eslint-disable-next-line` directive line, or undefined when it's none. */
const mergeDirective = (line: string, ruleIds: string[]): string | undefined => {
  const groups = EXISTING_DIRECTIVE.exec(line)?.groups;
  if (!groups) {
    return undefined;
  }
  const [rules = '', ...description] = (groups.body ?? '').split(/\s--\s/u);
  const existing = rules
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean);
  if (existing.length === 0) {
    return line;
  }
  const merged = [...existing, ...ruleIds.filter((rule) => !existing.includes(rule))];
  const reason = description.length > 0 ? ` -- ${description.join(' -- ')}` : '';
  const close = groups.close ? ` ${groups.close}` : '';
  return `${groups.indent ?? ''}${groups.open ?? ''} ${DIRECTIVE} ${merged.join(', ')}${reason}${close}`;
};

/** The rules per (1-based) line, in order of first appearance. */
const rulesPerLine = (problems: Problem[]): Map<number, string[]> => {
  const lines = new Map<number, string[]>();
  for (const { line, ruleId } of problems) {
    const rules = lines.get(line) ?? [];
    lines.set(line, rules.includes(ruleId) ? rules : [...rules, ruleId]);
  }
  return lines;
};

export type IgnoredSource = { text: string; comments: number; skipped: Problem[] };

/** The comment style for the (0-based) line, or undefined when it can't get a comment. */
const commentStyle = (
  lines: string[],
  index: number,
  contextOf: (line: number) => Context,
): CommentStyle | undefined => {
  const isShebang = index === 0 && lines[0]?.startsWith('#!') === true;
  const context = index < lines.length && !isShebang ? contextOf(index) : 'unsupported';
  return context === 'unsupported' ? undefined : context;
};

type Edit = { start: number; deleteCount: number; insert: string[] };

/**
 * Problems on the first line may be reported for the whole file (at 1:1), which a comment above it
 * doesn't cover; `eslint-disable` at the very start does. Scripts enable the rules again after it.
 */
const firstLineEdit = (
  lines: string[],
  style: CommentStyle,
  { ruleIds, contextOf }: { ruleIds: string[]; contextOf: (line: number) => Context },
): Edit => {
  if (style === 'html') {
    return {
      start: 0,
      deleteCount: 0,
      insert: [directiveComment(['<!--', '-->'], 'eslint-disable', ruleIds)],
    };
  }
  const disable = directiveComment(['/*', '*/'], 'eslint-disable', ruleIds);
  const next = lines.length > 1 ? contextOf(1) : 'unsupported';
  if (next === 'unsupported' || next === 'html') {
    return { start: 0, deleteCount: 0, insert: [disable] };
  }
  const indent = /^\s*/u.exec(lines[1] ?? '')?.[0] ?? '';
  const delimiters: [string, string] = next === 'jsx' ? ['{/*', '*/}'] : ['/*', '*/'];
  const enable = `${indent}${directiveComment(delimiters, 'eslint-enable', ruleIds)}`;
  return { start: 0, deleteCount: 1, insert: [disable, lines[0] ?? '', enable] };
};

/** Extends the directive above the line, or inserts one with the line's indentation. */
const commentLine = (
  lines: string[],
  index: number,
  comment: { style: CommentStyle; ruleIds: string[]; contextOf: (line: number) => Context },
): Edit => {
  if (index === 0) {
    return firstLineEdit(lines, comment.style, comment);
  }
  const merged = mergeDirective(lines[index - 1] ?? '', comment.ruleIds);
  if (merged !== undefined) {
    return { start: index - 1, deleteCount: 1, insert: [merged] };
  }
  const indent = /^\s*/u.exec(lines[index] ?? '')?.[0] ?? '';
  return {
    start: index,
    deleteCount: 0,
    insert: [`${indent}${ignoreComment(comment.style, comment.ruleIds)}`],
  };
};

/** Inserts or extends one directive comment above each line with problems. */
const insertComments = (
  lines: string[],
  problems: Problem[],
  contextOf: (line: number) => Context,
): Omit<IgnoredSource, 'text'> & { lines: string[] } => {
  const result = [...lines];
  const skipped: Problem[] = [];
  let comments = 0;
  const descending = [...rulesPerLine(problems)].sort(([a], [b]) => b - a);
  for (const [line, ruleIds] of descending) {
    const style = commentStyle(lines, line - 1, contextOf);
    if (style) {
      const { start, deleteCount, insert } = commentLine(lines, line - 1, {
        style,
        ruleIds,
        contextOf,
      });
      result.splice(start, deleteCount, ...insert);
      comments += 1;
    } else {
      skipped.push(...problems.filter((problem) => problem.line === line));
    }
  }
  return { lines: result, comments, skipped };
};

/**
 * Adds `eslint-disable-next-line` comments above the lines with problems of a JS/TS (incl. JSX) or
 * Vue file. Lines inside multi-line strings and files of other types are skipped.
 */
export const addIgnoreComments = (
  file: string,
  text: string,
  problems: Problem[],
): IgnoredSource => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  const contextOf = commentContexts(file, lines);
  if (!contextOf) {
    return { text, comments: 0, skipped: problems };
  }
  const result = insertComments(lines, problems, contextOf);
  return { text: result.lines.join(eol), comments: result.comments, skipped: result.skipped };
};

export type IgnoreResult = { files: string[]; comments: number; skipped: Problem[] };

/** Adds the ignore comments to the project files and writes them. */
export const ignoreProblems = (projectDir: string, problems: Problem[]): IgnoreResult => {
  const byFile = new Map<string, Problem[]>();
  for (const problem of problems) {
    byFile.set(problem.file, [...(byFile.get(problem.file) ?? []), problem]);
  }
  const result: IgnoreResult = { files: [], comments: 0, skipped: [] };
  for (const [file, list] of byFile) {
    const absolute = path.join(projectDir, file);
    const ignored = addIgnoreComments(file, readFileSync(absolute, 'utf8'), list);
    if (ignored.comments > 0) {
      writeFileSync(absolute, ignored.text);
      result.files.push(file);
      result.comments += ignored.comments;
    }
    result.skipped.push(...ignored.skipped);
  }
  return result;
};
