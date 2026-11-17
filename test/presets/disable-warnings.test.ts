import { describe, expect, it } from 'vitest';
import { disableWarnings, type Config } from '../../src/app';

describe('disableWarnings', () => {
  it("sets every 'warn' rule to 'off', keeping options and other severities", () => {
    const configs: Config[] = [
      {
        name: 'a',
        rules: { x: 'warn', y: 1, z: ['warn', { max: 3 }], e: 'error', f: ['error', 'x'] },
      },
      { name: 'b', files: ['**/*.ts'] },
    ];
    expect(disableWarnings(configs)).toEqual([
      {
        name: 'a',
        rules: { x: 'off', y: 'off', z: ['off', { max: 3 }], e: 'error', f: ['error', 'x'] },
      },
      { name: 'b', files: ['**/*.ts'] },
    ]);
  });

  it('does not change the input', () => {
    const configs: Config[] = [{ rules: { x: 'warn' } }];
    disableWarnings(configs);
    expect(configs).toEqual([{ rules: { x: 'warn' } }]);
  });
});
