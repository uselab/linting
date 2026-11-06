import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockAnswers = {
  presets: string[];
  texts: string[];
  /** Answer of the test files prompt; its prefilled value when undefined. */
  testFiles?: string;
  /** Answer of the lint scope prompt; its preselected value when undefined. */
  ignoresMode?: string;
  /** Answer of the lint scope globs prompt; its prefilled value when undefined. */
  ignoreGlobs?: string;
  warnings: string[];
  /** Messages of the select prompts, in order. */
  selects: string[];
  confirm: boolean;
  confirmDefaults: boolean[];
  /** Answer of the "run the lint analysis" prompt. */
  analyze: boolean;
  /** Answer of the "install the dependencies first" prompt. */
  install: boolean;
  /** Messages of the analyze and install prompts, in order. */
  analyzePrompts: string[];
};

const answers = vi.hoisted((): MockAnswers => ({
  presets: [],
  texts: [],
  warnings: [],
  selects: [],
  confirm: true,
  confirmDefaults: [],
  analyze: false,
  install: true,
  analyzePrompts: [],
}));

const mocks = vi.hoisted(() => ({
  runInstall: vi.fn<(projectDir: string, command: string) => boolean>(() => true),
  runAnalyze: vi.fn<
    (projectDir: string, interactive: boolean, options?: { intro?: boolean }) => Promise<void>
  >(async () => {}),
}));

vi.mock('../../src/features/cli/install', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstall: mocks.runInstall,
}));

vi.mock('../../src/features/cli/analyze', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAnalyze: mocks.runAnalyze,
}));

vi.mock('@clack/prompts', () => {
  const noop = (): void => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    cancel: noop,
    log: {
      info: noop,
      success: noop,
      warn: (message: string) => answers.warnings.push(message),
      error: noop,
      step: noop,
    },
    isCancel: () => false,
    multiselect: async () => answers.presets,
    select: async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      answers.selects.push(message);
      return answers.ignoresMode ?? initialValue;
    },
    text: async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      if (message.startsWith('Test files')) {
        return answers.testFiles ?? initialValue ?? '';
      }
      if (message.startsWith('Globs of')) {
        return answers.ignoreGlobs ?? initialValue ?? '';
      }
      return answers.texts.shift() ?? '';
    },
    confirm: async ({ message, initialValue }: { message: string; initialValue: boolean }) => {
      if (message.startsWith('Run the lint analysis')) {
        answers.analyzePrompts.push(message);
        return answers.analyze;
      }
      if (message.startsWith('The analysis needs')) {
        answers.analyzePrompts.push(message);
        return answers.install;
      }
      answers.confirmDefaults.push(initialValue);
      return answers.confirm;
    },
  };
});

const { run } = await import('../../src/features/cli/run');
const { readEslintConfig } = await import('../../src/features/cli/eslint-config');
const { findUncommittedChanges } = await import('../../src/features/cli/git');

let dir = '';
const read = (file: string): string => readFileSync(path.join(dir, file), 'utf8');

const git = (...args: string[]): void => {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: dir, stdio: 'ignore' },
  );
};

const commitAll = (): void => {
  git('add', '--all');
  git('commit', '--quiet', '--allow-empty', '--message', 'fixture');
};

/** Commits the fixture so the git checks pass, then runs init. */
const commitAndInit = async (target: string): Promise<void> => {
  commitAll();
  await run(['init', target]);
};

const failedWith = async (argv: string[]): Promise<string> => {
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await run(argv);
    expect(process.exitCode).toBe(1);
    return write.mock.calls.map(([chunk]) => String(chunk)).join('');
  } finally {
    process.exitCode = 0;
    write.mockRestore();
  }
};

beforeEach(() => {
  answers.confirmDefaults = [];
  answers.analyze = false;
  answers.install = true;
  answers.analyzePrompts = [];
  mocks.runInstall.mockReset().mockReturnValue(true);
  mocks.runAnalyze.mockReset();
  answers.testFiles = undefined;
  answers.ignoresMode = undefined;
  answers.ignoreGlobs = undefined;
  answers.warnings = [];
  answers.selects = [];
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-run-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: 'app', devDependencies: { eslint: '^9.0.0', vue: '^3.5.0' } },
      undefined,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }',
  );
  writeFileSync(path.join(dir, 'tsconfig.app.json'), '{\n  // app\n  "include": ["src"]\n}\n');
  writeFileSync(path.join(dir, 'tsconfig.node.json'), '{ "include": ["vite.config.ts"] }');
  writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];');
  writeFileSync(
    path.join(dir, 'vite.config.ts'),
    "import { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: [],\n})\n",
  );
  git('init', '--quiet');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('run init', () => {
  it('writes the configs and updates package.json and tsconfig.app.json', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'app',
          prettier: { semi: false },
          devDependencies: {
            eslint: '^9.0.0',
            'eslint-plugin-vue': '^9.0.0',
            '@vue/eslint-config-typescript': '^14.0.0',
            vue: '^3.5.0',
          },
        },
        undefined,
        2,
      ),
    );
    writeFileSync(path.join(dir, '.eslintrc.json'), '{}');
    writeFileSync(path.join(dir, '.prettierrc.yaml'), 'semi: false');
    answers.presets = [
      'javascript',
      'typescript',
      'vue',
      'browser',
      'aliases',
      'boundaries',
      'prettier',
    ];
    answers.texts = ['src', 'tsconfig.app.json'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('eslint.config.ts')).toContain(
      "...configs.boundaries({ tsconfig: 'tsconfig.app.json' }),",
    );
    expect(existsSync(path.join(dir, 'eslint.config.mts'))).toBe(false);
    expect(read('prettier.config.ts')).toContain(
      '  ...uselab,\n  // add custom configuration here',
    );
    for (const file of ['eslint.config.js', '.eslintrc.json', '.prettierrc.yaml']) {
      expect(existsSync(path.join(dir, file))).toBe(false);
    }
    const packageJson = JSON.parse(read('package.json'));
    expect(Object.keys(packageJson)).toEqual(['name', 'type', 'scripts', 'devDependencies']);
    expect(Object.keys(packageJson.scripts)).toEqual([
      'lint',
      'lint:fix',
      'lint:analyze',
      'format',
      'format:check',
      'typecheck',
    ]);
    expect(packageJson.scripts.typecheck).toBe('vue-tsc -b');
    expect(packageJson.devDependencies).toMatchObject({
      'vue-tsc': '^3.0.0',
      'vite-plugin-checker': '^0.14.0',
    });
    expect(packageJson.type).toBe('module');
    expect(packageJson.devDependencies).toMatchObject({
      eslint: '^10.4.0',
      jiti: '^2.2.0',
      vue: '^3.5.0',
    });
    expect(packageJson.devDependencies).not.toHaveProperty('eslint-plugin-vue');
    expect(packageJson.devDependencies).not.toHaveProperty('@vue/eslint-config-typescript');
    const tsconfig = read('tsconfig.app.json');
    expect(tsconfig).toContain('// app');
    expect(parse(tsconfig).compilerOptions.paths['@features/*']).toEqual(['./src/features/*']);
    const viteConfig = read('vite.config.ts');
    expect(viteConfig).toContain("from 'node:url'");
    expect(viteConfig).toMatch(/'@features': fileURLToPath\(\s*new URL\('.\/src\/features'/);
    expect(viteConfig).toContain("import checker from 'vite-plugin-checker'");
    expect(viteConfig).toContain("tsconfigPath: 'tsconfig.app.json'");
    expect(packageJson.devDependencies['@types/node']).toBe('^24');
    expect(parse(read('tsconfig.node.json'))).toEqual({
      include: ['vite.config.ts'],
      compilerOptions: { types: ['node'] },
    });
  });

  it('leaves the files directly in src untouched for the boundaries preset', async () => {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'main.ts'), "import App from './App.vue'\n");
    answers.presets = ['javascript', 'boundaries'];
    answers.texts = ['src', 'tsconfig.app.json'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('src/main.ts')).toBe("import App from './App.vue'\n");
    expect(existsSync(path.join(dir, 'src', 'app'))).toBe(false);
  });

  it('writes srcDirs and the tsconfig of each src folder for multiple src folders', async () => {
    for (const app of ['web', 'admin']) {
      mkdirSync(path.join(dir, 'apps', app, 'src', 'features'), { recursive: true });
      writeFileSync(path.join(dir, 'apps', app, 'tsconfig.json'), '{ "include": ["src"] }');
    }
    answers.presets = ['javascript', 'aliases', 'boundaries'];
    answers.texts = [
      'apps/admin/src, apps/web/src',
      'apps/admin/tsconfig.json, apps/web/tsconfig.json',
    ];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('eslint.config.ts')).toContain(
      "...configs.boundaries({ srcDirs: ['apps/admin/src', 'apps/web/src'], tsconfig: ['apps/admin/tsconfig.json', 'apps/web/tsconfig.json'] }),",
    );
    for (const app of ['web', 'admin']) {
      const paths = parse(read(`apps/${app}/tsconfig.json`)).compilerOptions.paths;
      expect(paths['@features/*']).toEqual(['./src/features/*']);
    }
  });

  it('adds @types/node and splits a single tsconfig that includes the Vite config', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "app", "type": "module", "engines": { "node": ">=22.18" } }',
    );
    rmSync(path.join(dir, 'tsconfig.app.json'));
    rmSync(path.join(dir, 'tsconfig.node.json'));
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{\n  "compilerOptions": { "types": ["vite/client"] },\n  "include": ["src/**/*.ts", "vite.config.ts"]\n}\n',
    );
    answers.presets = ['javascript', 'aliases', 'typescript'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(JSON.parse(read('package.json')).devDependencies['@types/node']).toBe('^22');
    expect(JSON.parse(read('package.json')).scripts.typecheck).toBe(
      'tsc --noEmit && tsc --noEmit -p tsconfig.node.json',
    );
    expect(read('vite.config.ts')).toContain('typescript: true');
    const tsconfig = parse(read('tsconfig.json'));
    expect(tsconfig.include).toEqual(['src/**/*.ts']);
    expect(tsconfig.compilerOptions.paths['@app/*']).toEqual(['./src/app/*']);
    expect(tsconfig.compilerOptions.noImplicitAny).toBe(true);
    expect(tsconfig.references).toBeUndefined();
    expect(parse(read('tsconfig.node.json'))).toMatchObject({
      compilerOptions: { types: ['node'] },
      include: ['vite.config.ts'],
    });
  });

  it('does not add @types/node for a JavaScript Vite config', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    rmSync(path.join(dir, 'vite.config.ts'));
    writeFileSync(path.join(dir, 'vite.config.js'), 'export default {};\n');
    answers.presets = ['javascript', 'aliases'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('vite.config.js')).toContain('node:url');
    expect(read('vite.config.js')).not.toContain('vite-plugin-checker');
    const packageJson = JSON.parse(read('package.json'));
    expect(packageJson.devDependencies).not.toHaveProperty('@types/node');
    expect(packageJson.devDependencies).not.toHaveProperty('vite-plugin-checker');
    expect(packageJson.scripts).not.toHaveProperty('typecheck');
  });

  it('keeps an existing vite-plugin-checker setup', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    const viteConfig =
      "import checker from 'vite-plugin-checker'\n\nexport default { plugins: [checker({ typescript: true })] }\n";
    writeFileSync(path.join(dir, 'vite.config.ts'), viteConfig);
    answers.presets = ['typescript'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('vite.config.ts')).toBe(viteConfig);
    expect(read('tsconfig.app.json')).not.toContain('paths');
    expect(JSON.parse(read('package.json')).devDependencies['vite-plugin-checker']).toBe('^0.14.0');
  });

  it('writes eslint.config.ts without asking about "type" when it is already a module', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    writeFileSync(path.join(dir, 'eslint.config.mts'), 'export default [];');
    answers.presets = ['javascript'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('eslint.config.ts')).toContain('...configs.javascript(),');
    expect(existsSync(path.join(dir, 'eslint.config.mts'))).toBe(false);
  });

  it('keeps a customised prettier config and renames it when the extension changes', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    const custom =
      "import uselab from '@uselab/linting/prettier';\n\nexport default { ...uselab, printWidth: 120 };\n";
    writeFileSync(path.join(dir, 'prettier.config.mts'), custom);
    writeFileSync(path.join(dir, '.prettierrc.json'), '"@uselab/linting/prettier"\n');
    answers.presets = ['javascript', 'prettier'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('prettier.config.ts')).toBe(custom);
    expect(existsSync(path.join(dir, 'prettier.config.mts'))).toBe(false);
    expect(existsSync(path.join(dir, '.prettierrc.json'))).toBe(false);
    expect(findUncommittedChanges(dir)).toContain('R  prettier.config.mts -> prettier.config.ts');
  });

  it('stages the new files in git, except the CommonJS refactor report', async () => {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'legacy.js'), 'module.exports = 1;\n');
    answers.presets = ['javascript', 'prettier'];
    answers.confirm = true;

    await commitAndInit(dir);

    const changes = findUncommittedChanges(dir);
    expect(changes).toEqual(
      expect.arrayContaining([
        'A  .github/hooks/uselab-linting.json',
        'A  eslint.config.ts',
        'A  prettier.config.ts',
        ' M package.json',
        '?? REFACTOR-COMMON-JS.md',
      ]),
    );
  });

  it('warns about new files that git ignores', async () => {
    writeFileSync(path.join(dir, '.gitignore'), 'prettier.config.ts\n');
    answers.presets = ['javascript', 'prettier'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(findUncommittedChanges(dir)).toContain('A  eslint.config.ts');
    expect(answers.warnings).toContainEqual(
      expect.stringContaining('Could not add prettier.config.ts'),
    );
  });

  it('overwrites existing lint scripts and appends the missing ones', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "app", "type": "module", "scripts": { "dev": "vite", "lint": "eslint src" } }',
    );
    answers.presets = ['javascript', 'prettier'];
    answers.confirm = true;

    await commitAndInit(dir);

    const { scripts } = JSON.parse(read('package.json'));
    expect(Object.keys(scripts)).toEqual([
      'dev',
      'lint',
      'lint:fix',
      'lint:analyze',
      'format',
      'format:check',
    ]);
    expect(scripts.lint).toBe('eslint . --cache --cache-location node_modules/.cache/eslint/');
  });

  it('only keeps CommonJS when "type": "module" is declined, and applies the rest', async () => {
    answers.presets = ['javascript', 'aliases'];
    answers.confirm = false;

    await commitAndInit(dir);

    expect(read('eslint.config.mts')).toContain('...configs.javascript(),');
    expect(existsSync(path.join(dir, 'eslint.config.ts'))).toBe(false);
    expect(existsSync(path.join(dir, 'eslint.config.js'))).toBe(false);
    expect(existsSync(path.join(dir, 'prettier.config.mts'))).toBe(false);
    const packageJson = JSON.parse(read('package.json'));
    expect(packageJson.type).toBeUndefined();
    expect(packageJson.devDependencies.eslint).toBe('^10.4.0');
    expect(read('tsconfig.app.json')).toContain('paths');
    expect(read('vite.config.ts')).toContain('alias');
  });

  it('renames an existing @uselab/linting config to the target name, keeping custom entries', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    writeFileSync(
      path.join(dir, 'eslint.config.js'),
      [
        "import { configs } from '@uselab/linting';",
        '',
        'export default [',
        '  ...configs.ignores(),',
        '  ...configs.javascript(),',
        "  { rules: { 'no-console': 'off' } },",
        '];',
        '',
      ].join('\n'),
    );
    answers.presets = ['javascript', 'vue'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(existsSync(path.join(dir, 'eslint.config.js'))).toBe(false);
    const config = read('eslint.config.ts');
    expect(config).toContain("{ rules: { 'no-console': 'off' } },");
    expect(config).toContain('...configs.vue,');
    const changes = findUncommittedChanges(dir);
    expect(changes.some((line) => /^[AR] {2}.*eslint\.config\.ts$/u.test(line))).toBe(true);
    expect(changes.some((line) => /^[DR] {2}eslint\.config\.js/u.test(line))).toBe(true);
  });

  it('updates an existing @uselab/linting config, keeping custom entries', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    writeFileSync(
      path.join(dir, 'eslint.config.ts'),
      [
        "import { configs } from '@uselab/linting';",
        '',
        'export default [',
        '  ...configs.ignores(),',
        '  ...configs.javascript(),',
        "  { rules: { 'no-console': 'off' } },",
        '];',
        '',
      ].join('\n'),
    );
    answers.presets = ['javascript', 'vue'];
    answers.confirm = true;

    await commitAndInit(dir);

    const config = read('eslint.config.ts');
    expect(config).toContain("{ rules: { 'no-console': 'off' } },");
    expect(config).toContain('...configs.vue,');
    expect(config).toContain("import { globalIgnores } from 'eslint/config';");
    expect(config).toContain("  globalIgnores([\n    '**/dist/**',");
    expect(config).not.toContain('configs.ignores');
  });

  it('writes the chosen test file globs', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    answers.presets = ['javascript'];
    answers.testFiles = '**/*.test.ts, e2e/**';
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('eslint.config.ts')).toContain(
      "...configs.javascript({ testFiles: ['**/*.test.ts', 'e2e/**'] }),",
    );
  });

  it('accepts empty test file globs', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    answers.presets = ['javascript'];
    answers.testFiles = '';
    answers.confirm = true;

    await commitAndInit(dir);

    expect(read('eslint.config.ts')).toContain('...configs.javascript({ testFiles: [] }),');
  });

  it('prefills the test file globs of an existing config', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    const javascript = "...configs.javascript({ testFiles: ['e2e/**'] }),";
    writeFileSync(
      path.join(dir, 'eslint.config.ts'),
      ["import { configs } from '@uselab/linting';", `export default [${javascript}];`, ''].join(
        '\n',
      ),
    );
    answers.presets = ['javascript', 'node'];
    answers.confirm = true;

    await commitAndInit(dir);

    const config = read('eslint.config.ts');
    expect(config).toContain("...configs.javascript({ testFiles: ['e2e/**'] })");
    expect(config).toContain('...configs.node');
  });

  it('defaults to "type": "module" without CommonJS code and writes no report', async () => {
    answers.presets = ['javascript'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(answers.confirmDefaults).toEqual([true, true]);
    expect(JSON.parse(read('package.json')).type).toBe('module');
    expect(existsSync(path.join(dir, 'REFACTOR-COMMON-JS.md'))).toBe(false);
  });

  it('replaces "type": "commonjs" and writes a report of the CommonJS code', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "app",\n  "type": "commonjs"\n}\n');
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(
      path.join(dir, 'scripts', 'build.js'),
      "const fs = require('node:fs');\nmodule.exports = fs;\n",
    );
    answers.presets = ['javascript'];
    answers.confirm = true;

    await commitAndInit(dir);

    expect(answers.confirmDefaults).toEqual([true, true]);
    const packageJson = JSON.parse(read('package.json'));
    const keys = Object.keys(packageJson);
    expect(keys[keys.indexOf('name') + 1]).toBe('type');
    expect(packageJson.type).toBe('module');
    expect(read('eslint.config.ts')).toContain('...configs.javascript(),');
    const report = read('REFACTOR-COMMON-JS.md').split('\n');
    const heading = report.findIndex((line) => line.includes('scripts/build.js'));
    const requireLine = report.findIndex((line) => line.includes("const fs = require('node:fs');"));
    const exportsLine = report.findIndex(
      (line) => line.includes('module.exports') && /\b2\b/.test(line),
    );
    expect(heading).toBeGreaterThan(-1);
    expect(requireLine).toBeGreaterThan(heading);
    expect(exportsLine).toBeGreaterThan(requireLine);
  });

  it('defaults to No with more than 20 CommonJS usages and writes no report when declined', async () => {
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(
      path.join(dir, 'scripts', 'many.js'),
      Array.from({ length: 21 }, (_, index) => `require('x${index}');`).join('\n'),
    );
    answers.presets = ['javascript'];
    answers.confirm = false;

    await commitAndInit(dir);

    expect(answers.confirmDefaults).toEqual([false, true]);
    expect(JSON.parse(read('package.json')).type).toBeUndefined();
    expect(existsSync(path.join(dir, 'REFACTOR-COMMON-JS.md'))).toBe(false);
    expect(existsSync(path.join(dir, '.github', 'hooks', 'uselab-linting.json'))).toBe(false);
  });

  it('writes the Copilot hook to the repository root, running in the project directory', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "app", "type": "module" }');
    const projectDir = path.join(dir, 'packages', 'web');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'package.json'), '{ "name": "web", "type": "module" }');
    answers.presets = ['javascript'];
    answers.confirm = true;

    await commitAndInit(projectDir);

    expect(answers.confirmDefaults).toEqual([true]);
    expect(JSON.parse(read('.github/hooks/uselab-linting.json'))).toEqual({
      version: 1,
      hooks: {
        postToolUse: [
          {
            type: 'command',
            matcher: 'edit|create|apply_patch|str_replace_editor',
            command: 'npx --no uselab-linting copilot-hook',
            cwd: 'packages/web',
            timeoutSec: 60,
          },
        ],
      },
    });
  });

  it('fails for a missing target directory', async () => {
    await failedWith(['init', path.join(dir, 'missing')]);
  });

  it('fails outside a git repository without changing anything', async () => {
    rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    answers.presets = ['javascript'];
    answers.confirm = true;

    await failedWith(['init', dir]);

    expect(existsSync(path.join(dir, 'eslint.config.js'))).toBe(true);
    expect(existsSync(path.join(dir, 'eslint.config.ts'))).toBe(false);
  });

  it('fails with uncommitted changes, including untracked files', async () => {
    commitAll();
    writeFileSync(path.join(dir, 'vite.config.ts'), 'export default {};\n');
    writeFileSync(path.join(dir, 'new-file.ts'), '');
    answers.presets = ['javascript'];
    answers.confirm = true;

    const output = await failedWith(['init', dir]);

    expect(output).toContain(' M vite.config.ts');
    expect(output).toContain('?? new-file.ts');
    expect(existsSync(path.join(dir, 'eslint.config.ts'))).toBe(false);
  });
});

describe('run init analyze offer', () => {
  const ownVersion = (): string =>
    JSON.parse(readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8')).version;

  /** A module project with the javascript preset's dependencies declared and installed. */
  const writeInstalledProject = (): void => {
    const version = ownVersion();
    const devDependencies = { '@uselab/linting': `^${version}`, eslint: '^10.4.0', jiti: '^2.2.0' };
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'app', type: 'module', devDependencies }, undefined, 2),
    );
    const installed = { '@uselab/linting': version, eslint: '10.4.0', jiti: '2.2.0' };
    for (const [name, packageVersion] of Object.entries(installed)) {
      mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
      writeFileSync(
        path.join(dir, 'node_modules', name, 'package.json'),
        JSON.stringify({ name, version: packageVersion }),
      );
    }
  };

  beforeEach(() => {
    answers.presets = ['javascript'];
    answers.confirm = false;
  });

  it('offers the analysis with Yes as default and does nothing when declined', async () => {
    await commitAndInit(dir);

    expect(answers.analyzePrompts).toEqual(['Run the lint analysis (uselab-linting analyze) now?']);
    expect(mocks.runInstall).not.toHaveBeenCalled();
    expect(mocks.runAnalyze).not.toHaveBeenCalled();
  });

  it('runs the analysis without installing when the dependencies are installed', async () => {
    writeInstalledProject();
    answers.analyze = true;

    await commitAndInit(dir);

    expect(answers.analyzePrompts).toHaveLength(1);
    expect(mocks.runInstall).not.toHaveBeenCalled();
    expect(mocks.runAnalyze).toHaveBeenCalledWith(dir, true, { intro: false });
  });

  it('offers npm install first when init changed the dependencies', async () => {
    answers.analyze = true;

    await commitAndInit(dir);

    expect(answers.analyzePrompts[1]).toBe(
      'The analysis needs the dependencies installed. Run npm install first?',
    );
    expect(mocks.runInstall).toHaveBeenCalledWith(dir, 'npm install');
    expect(mocks.runAnalyze).toHaveBeenCalledWith(dir, true, { intro: false });
  });

  it('offers npm install first when a declared dependency is not installed', async () => {
    writeInstalledProject();
    rmSync(path.join(dir, 'node_modules', 'jiti'), { recursive: true, force: true });
    answers.analyze = true;

    await commitAndInit(dir);

    expect(mocks.runInstall).toHaveBeenCalledWith(dir, 'npm install');
    expect(mocks.runAnalyze).toHaveBeenCalled();
  });

  it('skips the analysis when the install is declined', async () => {
    answers.analyze = true;
    answers.install = false;

    await commitAndInit(dir);

    expect(mocks.runInstall).not.toHaveBeenCalled();
    expect(mocks.runAnalyze).not.toHaveBeenCalled();
  });

  it('skips the analysis when the install fails', async () => {
    answers.analyze = true;
    mocks.runInstall.mockReturnValue(false);

    await commitAndInit(dir);

    expect(mocks.runInstall).toHaveBeenCalled();
    expect(mocks.runAnalyze).not.toHaveBeenCalled();
  });
});

describe('run init lint scope', () => {
  const CONFIG = 'eslint.config.mts';

  /** Commits the project, then runs init with the given scope answers. */
  const initWithScope = async (mode?: string, globs?: string): Promise<void> => {
    answers.presets = ['javascript'];
    answers.confirm = false;
    answers.ignoresMode = mode;
    answers.ignoreGlobs = globs;
    await commitAndInit(dir);
  };

  it('writes the chosen lint scope and preselects it on the next run', async () => {
    const scope = () => readEslintConfig(read(CONFIG))?.ignores;
    await initWithScope('only', 'src/**, test/**');
    expect(read(CONFIG)).toContain("    '!test/**',\n    '**/dist/**',");
    expect(scope()).toEqual({ mode: 'only', globs: ['src/**', 'test/**'] });

    await initWithScope();
    expect(scope()).toEqual({ mode: 'only', globs: ['src/**', 'test/**'] });

    await initWithScope('exclude', 'legacy/**');
    expect(read(CONFIG)).toContain("  globalIgnores([\n    'legacy/**',\n    '**/dist/**',");
    expect(scope()).toEqual({ mode: 'exclude', globs: ['legacy/**'] });

    await initWithScope('all');
    expect(read(CONFIG)).toContain("  globalIgnores([\n    '**/dist/**',");
    expect(scope()).toEqual({ mode: 'all', globs: [] });
  });

  it('mentions the default ignores in the scope question', async () => {
    await initWithScope('all');
    expect(answers.selects).toContain(
      'Which files should ESLint lint? (dist, node_modules, *.tsbuildinfo are always ignored)',
    );
  });

  it('leaves non-literal configs.ignores() unchanged without asking', async () => {
    const text = [
      "import { configs } from '@uselab/linting';",
      "const legacy = ['legacy/**'];",
      '',
      'export default [...configs.ignores(legacy), ...configs.javascript()];',
      '',
    ].join('\n');
    rmSync(path.join(dir, 'eslint.config.js'));
    writeFileSync(path.join(dir, CONFIG), text);

    await initWithScope('exclude', 'other/**');

    expect(read(CONFIG)).toBe(text);
    expect(answers.warnings.some((warning) => warning.includes('globalIgnores(['))).toBe(true);
  });
});
