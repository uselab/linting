import { describe, expect, it } from 'vitest';
import { configs } from '../../src/app';
import { lintRule } from '../helpers';

const config = [...configs.javascript(), ...configs.aliases()];
const FILE = 'src/some-file.js';

describe('no-restricted-imports (no parent-relative imports)', () => {
  const lintImports = lintRule(config, 'no-restricted-imports');

  it.each(["import a from '../a';", "import a from '..';", "import a from '../../b/c';"])(
    'reports %s',
    async (code) => {
      expect(await lintImports(FILE, code)).toHaveLength(1);
    },
  );

  it.each([
    "import a from './a';",
    "import a from '@app/a';",
    "import a from '@features/orders';",
    "import a from '@support/format';",
  ])('allows %s', async (code) => {
    expect(await lintImports(FILE, code)).toEqual([]);
  });
});

describe('with the node preset after aliases', () => {
  const lintNode = lintRule(
    [...configs.javascript(), ...configs.aliases(), ...configs.node({ ignores: ['src/web/**'] })],
    'no-restricted-imports',
  );

  it('allows parent-relative imports in Node files', async () => {
    expect(await lintNode(FILE, "import a from '../a';")).toEqual([]);
  });

  it('still reports them in the ignored (browser) files', async () => {
    expect(await lintNode('src/web/page.js', "import a from '../a';")).toHaveLength(1);
  });
});
