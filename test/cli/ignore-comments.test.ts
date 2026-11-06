import { describe, expect, it } from 'vitest';
import type { Problem } from '../../src/features/cli/analyze';
import { addIgnoreComments, ignoreComment } from '../../src/features/cli/ignore-comments';

const problem = (line: number, ruleId = 'rule-a'): Problem => ({
  ruleId,
  file: 'file',
  line,
  column: 1,
  message: 'message',
  severity: 2,
  fixable: false,
});

const ignore = (file: string, lines: string[], problems: Problem[]) =>
  addIgnoreComments(file, lines.join('\n'), problems);

describe('ignoreComment', () => {
  it('uses the comment syntax of the context', () => {
    expect(ignoreComment('line', ['a', 'b'])).toBe('// eslint-disable-next-line a, b');
    expect(ignoreComment('jsx', ['a'])).toBe('{/* eslint-disable-next-line a */}');
    expect(ignoreComment('html', ['a'])).toBe('<!-- eslint-disable-next-line a -->');
  });
});

describe('addIgnoreComments', () => {
  it('adds one comment per line with the indentation of the line', () => {
    const result = ignore(
      'a.ts',
      ['function f() {', '  var x = 1;', '  return x;', '}'],
      [problem(2), problem(2, 'rule-b'), problem(2), problem(3)],
    );
    expect(result.text).toBe(
      [
        'function f() {',
        '  // eslint-disable-next-line rule-a, rule-b',
        '  var x = 1;',
        '  // eslint-disable-next-line rule-a',
        '  return x;',
        '}',
      ].join('\n'),
    );
    expect(result.comments).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it('extends an existing directive above the line', () => {
    const result = ignore(
      'a.js',
      [
        '  // eslint-disable-next-line rule-a -- reason',
        '  x();',
        '/* eslint-disable-next-line c */',
        'y();',
      ],
      [problem(2), problem(2, 'rule-b'), problem(4)],
    );
    expect(result.text).toBe(
      [
        '  // eslint-disable-next-line rule-a, rule-b -- reason',
        '  x();',
        '/* eslint-disable-next-line c, rule-a */',
        'y();',
      ].join('\n'),
    );
  });

  it('disables the rules around the first line, which may hold file-level problems', () => {
    expect(ignore('a.js', ['a();', 'b();'], [problem(1), problem(2, 'rule-b')]).text).toBe(
      [
        '/* eslint-disable rule-a */',
        'a();',
        '/* eslint-enable rule-a */',
        '// eslint-disable-next-line rule-b',
        'b();',
      ].join('\n'),
    );
    expect(ignore('a.vue', ['<script setup>', '</script>'], [problem(1)]).text).toBe(
      ['<!-- eslint-disable rule-a -->', '<script setup>', '</script>'].join('\n'),
    );
  });

  it('keeps CRLF line endings', () => {
    expect(addIgnoreComments('a.js', 'a();\r\nb();\r\n', [problem(2)]).text).toBe(
      'a();\r\n// eslint-disable-next-line rule-a\r\nb();\r\n',
    );
  });

  it('uses JSX comments for JSX children only', () => {
    const result = ignore(
      'a.tsx',
      [
        'const A = () => (',
        '  <div',
        '    className="a"',
        '  >',
        '    <span>{x}</span>',
        '    {y}',
        '    text',
        '    {items.map((item) => (',
        '      <Item key={item} />',
        '    ))}',
        '  </div>',
        ');',
      ],
      [2, 3, 5, 6, 7, 9, 11].map((line) => problem(line)),
    );
    expect(result.text.split('\n')).toEqual([
      'const A = () => (',
      '  // eslint-disable-next-line rule-a',
      '  <div',
      '    // eslint-disable-next-line rule-a',
      '    className="a"',
      '  >',
      '    {/* eslint-disable-next-line rule-a */}',
      '    <span>{x}</span>',
      '    {/* eslint-disable-next-line rule-a */}',
      '    {y}',
      '    {/* eslint-disable-next-line rule-a */}',
      '    text',
      '    {items.map((item) => (',
      '      // eslint-disable-next-line rule-a',
      '      <Item key={item} />',
      '    ))}',
      '  {/* eslint-disable-next-line rule-a */}',
      '  </div>',
      ');',
    ]);
  });

  it('skips lines inside multi-line strings, shebangs and unsupported files', () => {
    const result = ignore(
      'a.js',
      ['#!/usr/bin/env node', 'const s = `', '  text`;'],
      [problem(1), problem(3)],
    );
    expect(result.comments).toBe(0);
    expect(result.skipped.map(({ line }) => line)).toEqual([3, 1]);
    expect(ignore('a.json', ['{}'], [problem(1)]).skipped).toHaveLength(1);
  });

  it('uses HTML comments in Vue templates and script comments in Vue scripts', () => {
    const result = ignore(
      'a.vue',
      [
        '<script setup lang="tsx">',
        'const a = 1;',
        'const b = <div>',
        '  <span />',
        '</div>;',
        '</script>',
        '',
        '<template>',
        '  <div>',
        '    <!-- eslint-disable-next-line vue/a -->',
        '    <span v-if="a" />',
        '  </div>',
        '</template>',
      ],
      [problem(2), problem(4), problem(9, 'vue/b'), problem(11, 'vue/b')],
    );
    expect(result.text.split('\n')).toEqual([
      '<script setup lang="tsx">',
      '// eslint-disable-next-line rule-a',
      'const a = 1;',
      'const b = <div>',
      '  {/* eslint-disable-next-line rule-a */}',
      '  <span />',
      '</div>;',
      '</script>',
      '',
      '<template>',
      '  <!-- eslint-disable-next-line vue/b -->',
      '  <div>',
      '    <!-- eslint-disable-next-line vue/a, vue/b -->',
      '    <span v-if="a" />',
      '  </div>',
      '</template>',
    ]);
  });
});
