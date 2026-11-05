import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import prettierConfig from '../src/app/prettier';

const formatTs = async (code: string): Promise<string> =>
  format(code, { ...prettierConfig, filepath: 'example.ts' });

describe('shared prettier config', () => {
  it('uses single quotes, semicolons and CRLF line endings', async () => {
    expect(await formatTs('const a = "b"\n')).toBe("const a = 'b';\r\n");
  });

  it('adds trailing commas everywhere', async () => {
    const code = `const f = (${'parameterName'.repeat(4)}: string, ${'otherParameter'.repeat(4)}: string) => 1;\n`;
    const output = await formatTs(code);
    expect(output).toContain('string,\r\n) => 1;');
  });

  it('wraps at 100 characters', async () => {
    const fits = `const value = [${Array.from({ length: 8 }, (_, i) => `'item${i}'`).join(', ')}];`;
    expect(fits.length).toBeLessThanOrEqual(100);
    expect(await formatTs(fits)).toBe(`${fits}\r\n`);

    const tooLong = `const value = [${Array.from({ length: 12 }, (_, i) => `'item${i}'`).join(', ')}];`;
    expect(tooLong.length).toBeGreaterThan(100);
    expect((await formatTs(tooLong)).split('\r\n').length).toBeGreaterThan(2);
  });

  it('adds curly braces (prettier-plugin-curly)', async () => {
    expect(await formatTs('if (a) b();\n')).toBe('if (a) {\r\n  b();\r\n}\r\n');
  });
});
