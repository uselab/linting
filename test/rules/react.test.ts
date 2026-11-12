import reactHooks from 'eslint-plugin-react-hooks';
import { describe, expect, it } from 'vitest';
import { javascriptPreset, reactPreset, typescriptPreset } from '../../src/app';
import { byRule, configForFile, lintRule, lintSnippet, severityOf } from '../helpers';

const config = [...javascriptPreset(), ...typescriptPreset(), ...reactPreset()];
const FILE = 'src/components/user-card.tsx';

describe('no-restricted-syntax in JSX files', () => {
  const rule = 'no-restricted-syntax';

  it('reports inline style props', async () => {
    const code = "export const UserCard = () => <p style={{ color: 'red' }}>a</p>;";
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('reports props.<name> in JSX', async () => {
    const code = 'export const UserCard = (props: { title: string }) => <p>{props.title}</p>;';
    expect(await lintRule(config, rule)(FILE, code)).toHaveLength(1);
  });

  it('keeps the base null restriction and allows classes', async () => {
    const code = 'export const value = null;\nexport class UserStore {}';
    const messages = await lintRule(config, rule)(FILE, code);
    expect(messages.map((message) => message.line)).toEqual([1]);
  });

  it('allows destructured props and className', async () => {
    const code =
      "export const UserCard = ({ title }: { title: string }) => <p className='a'>{title}</p>;";
    expect(await lintRule(config, rule)(FILE, code)).toEqual([]);
  });
});

describe('duplicate hook rules', () => {
  const hookRules = Object.keys(reactHooks.rules);

  it.each(['src/use-user.ts', FILE, 'src/use-user.js'])(
    'disables @eslint-react ports of react-hooks rules (%s)',
    async (file) => {
      const resolved = await configForFile(config, file);
      for (const rule of hookRules) {
        expect(severityOf(resolved, `@eslint-react/${rule}`) ?? 0, `@eslint-react/${rule}`).toBe(0);
      }
    },
  );

  it('reports a hook violation once, by react-hooks', async () => {
    const code =
      "import { useState } from 'react';\nexport const UserCard = ({ show }: { show: boolean }) => {\n  if (show) {\n    const [count, setCount] = useState(0);\n    setCount(count);\n  }\n  return <p>a</p>;\n};";
    const messages = await lintSnippet(config, FILE, code);
    expect(byRule(messages, 'react-hooks/rules-of-hooks')).toHaveLength(1);
    const duplicates = new Set(hookRules.map((rule) => `@eslint-react/${rule}`));
    expect(messages.filter((message) => duplicates.has(message.ruleId ?? ''))).toEqual([]);
  });
});
