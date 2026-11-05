import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findCommonJsUsages,
  FIX_HINTS,
  formatUsages,
  moduleTypeNote,
  refactorReport,
  type CommonJsUsage,
} from '../../src/features/cli/commonjs';

let dir = '';

const write = (file: string, content: string): void => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-commonjs-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findCommonJsUsages', () => {
  it('finds every CommonJS pattern with file and line', () => {
    write(
      'src/server.js',
      [
        "const express = require('express');",
        "const file = require.resolve('x');",
        'module.exports = { express };',
        'exports.port = 3000;',
        "const root = path.join(__dirname, '..', __filename);",
      ].join('\n'),
    );
    write('src/legacy.ts', "import fs = require('node:fs');\r\nexport = fs;\r\n");

    expect(
      findCommonJsUsages(dir).map(({ file, line, kinds }) => `${file}:${line} ${kinds.join(', ')}`),
    ).toEqual([
      'src/legacy.ts:1 import = require()',
      'src/legacy.ts:2 export =',
      'src/server.js:1 require()',
      'src/server.js:2 require()',
      'src/server.js:3 module.exports',
      'src/server.js:4 exports.x =',
      'src/server.js:5 __dirname, __filename',
    ]);
  });

  it('skips UMD wrappers, also when the guard is on another line', () => {
    write(
      'lib/plugin.js',
      [
        '(function (factory) {',
        "  if (typeof module === 'object' && module.exports) {",
        "    module.exports = factory(require('jquery'));",
        '  } else {',
        '    factory(jQuery);',
        '  }',
        '})(function ($) {});',
      ].join('\n'),
    );
    write(
      'lib/amd.js',
      '!function(f){"function"==typeof define&&define.amd?define([],f):module.exports=f()}(x);',
    );
    expect(findCommonJsUsages(dir)).toEqual([]);
  });

  it('skips minified files', () => {
    write('lib/a.min.js', "module.exports = require('x');");
    write('lib/bundle.js', `var a=require('x');${'a+=1;'.repeat(100)}`);
    expect(findCommonJsUsages(dir)).toEqual([]);
  });

  it('shortens long lines to about 100 characters around the match', () => {
    const before = `const value = [${'1, '.repeat(40)}];`;
    write('src/long.js', `${before} const x = require('x'); const y = [${'2, '.repeat(40)}];`);
    const [found] = findCommonJsUsages(dir);
    expect(found?.text).toContain("require('x')");
    expect(found?.text.startsWith('…')).toBe(true);
    expect(found?.text.endsWith('…')).toBe(true);
    expect(found?.text.length).toBeLessThanOrEqual(102);
  });

  it('ignores ES modules, comments and look-alikes', () => {
    write(
      'src/main.ts',
      [
        "import fs from 'node:fs';",
        '// const x = require("x");',
        '/* module.exports = {} */',
        ' * uses __dirname',
        'export default fs;',
        'const required = myrequire(1) + obj.require(2);',
        'if (exports.x === 1) {}',
      ].join('\n'),
    );
    expect(findCommonJsUsages(dir)).toEqual([]);
  });

  it('skips fixed-type extensions, declarations, skipped directories and skipFiles', () => {
    write('a.cjs', "require('x');");
    write('b.mts', "require('x');");
    write('types.d.ts', 'export = Foo;');
    write('node_modules/pkg/index.js', "require('x');");
    write('dist/index.js', "require('x');");
    write('.husky/hook.js', "require('x');");
    write('.eslintrc.js', 'module.exports = {};');
    write('src/app.vue', "<script>require('x')</script>");
    expect(findCommonJsUsages(dir, ['.eslintrc.js'])).toEqual([]);
  });
});

const usage = (line: number): CommonJsUsage => ({
  file: 'src/a.js',
  line,
  kinds: ['require()'],
  text: "require('x')",
});

const usages = (count: number, first = 1): CommonJsUsage[] =>
  Array.from({ length: count }, (_, index) => usage(index + first));

/** Whether a line shows this usage's file and line number. */
const showsUsage = (line: string, { file, line: number }: CommonJsUsage): boolean =>
  new RegExp(`${file}:${number}\\b`).test(line);

describe('formatUsages', () => {
  it('lists all usages up to the limit, one per line', () => {
    const list = usages(2);
    const lines = formatUsages(list).split('\n');
    expect(lines).toHaveLength(2);
    list.forEach((item, index) => {
      expect(showsUsage(lines[index] ?? '', item)).toBe(true);
      expect(lines[index]).toContain(item.kinds[0]);
    });
  });

  it('lists at most 10 by default, then one line with how many more', () => {
    const list = usages(13);
    const lines = formatUsages(list).split('\n');
    expect(lines).toHaveLength(11);
    list.slice(0, 10).forEach((item, index) => {
      expect(showsUsage(lines[index] ?? '', item)).toBe(true);
    });
    expect(lines.some((line) => showsUsage(line, usage(11)))).toBe(false);
    expect(lines[10]).toMatch(/\b3\b/);
  });
});

describe('moduleTypeNote', () => {
  it('mentions the current type and lists no usages when nothing was found', () => {
    const note = moduleTypeNote('commonjs', []);
    expect(note).toContain('"commonjs"');
    expect(note).not.toContain('src/a.js');
  });

  it('lists at most 10 usages', () => {
    const list = usages(21, 0);
    const lines = moduleTypeNote(undefined, list).split('\n');
    for (const item of list) {
      expect(lines.some((line) => showsUsage(line, item))).toBe(list.indexOf(item) < 10);
    }
  });

  it('adds an explanation above 20 usages', () => {
    const lineCount = (count: number): number =>
      moduleTypeNote(undefined, usages(count)).split('\n').length;
    expect(lineCount(21)).toBe(lineCount(20) + 1);
  });
});

describe('refactorReport', () => {
  it('lists all usages per file with fix hints for the used kinds only', () => {
    const dirnameUsage: CommonJsUsage = {
      file: 'b.ts',
      line: 4,
      kinds: ['__dirname', '__filename'],
      text: 'const d = `${__dirname}${__filename}`;',
    };
    const list = [...usages(12), dirnameUsage];
    const lines = refactorReport(list).split('\n');
    const fileHeading = (file: string): number =>
      lines.findIndex((line) => line.includes(file) && !line.includes(':'));

    for (const item of list) {
      const index = lines.findIndex(
        (line) => line.includes(item.text) && new RegExp(`\\b${item.line}\\b`).test(line),
      );
      expect(index).toBeGreaterThan(fileHeading(item.file));
      expect(fileHeading(item.file)).toBeGreaterThan(-1);
    }
    expect(lines.some((line) => line.includes(FIX_HINTS.__dirname))).toBe(true);
    expect(lines.some((line) => line.includes(FIX_HINTS.__filename))).toBe(true);
    expect(lines.filter((line) => line.includes('__dirname') && /\b4\b/.test(line))).toHaveLength(
      1,
    );
    expect(lines.some((line) => line.includes(FIX_HINTS['module.exports']))).toBe(false);
  });
});
