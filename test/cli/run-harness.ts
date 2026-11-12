import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, vi } from 'vitest';

type MockAnswers = {
  presets: string[];
  texts: string[];
  /** Answer of the test files prompt; its prefilled value when undefined. */
  testFiles?: string;
  /** Answer of the lint scope prompt; its preselected value when undefined. */
  ignoresMode?: string;
  /** Answer of the lint scope globs prompt; its prefilled value when undefined. */
  ignoreGlobs?: string;
  /** Answer of the project type prompt; its preselected value when undefined. */
  projectType?: string;
  /** Answer of the browser files prompt; its prefilled value when undefined. */
  browserFiles?: string;
  /** Initial values of the project type and browser files prompts. */
  environmentDefaults: (string | undefined)[];
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

const hoisted = vi.hoisted(() => {
  const answers: MockAnswers = {
    presets: [],
    texts: [],
    environmentDefaults: [],
    warnings: [],
    selects: [],
    confirm: true,
    confirmDefaults: [],
    analyze: false,
    install: true,
    analyzePrompts: [],
  };
  const mocks = {
    runInstall: vi.fn<(projectDir: string, command: string) => boolean>(() => true),
    runAnalyze: vi.fn<
      (projectDir: string, interactive: boolean, options?: { intro?: boolean }) => Promise<void>
    >(async () => {}),
  };
  return { answers, mocks };
});

export const { answers, mocks } = hoisted;

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
      if (message.startsWith('Is this a browser')) {
        answers.environmentDefaults.push(initialValue);
        return answers.projectType ?? initialValue;
      }
      if (message.startsWith('Which library handles server state')) {
        return 'no';
      }
      answers.selects.push(message);
      return answers.ignoresMode ?? initialValue;
    },
    text: async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      const prefilled: [string, () => string | undefined][] = [
        ['Browser files', () => answers.browserFiles],
        ['Test files', () => answers.testFiles],
        ['Globs of', () => answers.ignoreGlobs],
      ];
      const match = prefilled.find(([prefix]) => message.startsWith(prefix));
      if (match === undefined) {
        return answers.texts.shift() ?? '';
      }
      if (match[0] === 'Browser files') {
        answers.environmentDefaults.push(initialValue);
      }
      return match[1]() ?? initialValue ?? '';
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

export const { run } = await import('../../src/features/cli/run');
export const { readEslintConfig } = await import('../../src/features/cli/eslint-config');
export const { findUncommittedChanges } = await import('../../src/features/cli/git');

export let dir = '';
export const read = (file: string): string => readFileSync(path.join(dir, file), 'utf8');

export const git = (...args: string[]): void => {
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

export const commitAll = (): void => {
  git('add', '--all');
  git('commit', '--quiet', '--allow-empty', '--message', 'fixture');
};

/** Commits the fixture so the git checks pass, then runs init. */
export const commitAndInit = async (target: string): Promise<void> => {
  commitAll();
  await run(['init', target]);
};

export const failedWith = async (argv: string[]): Promise<string> => {
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
  answers.projectType = undefined;
  answers.browserFiles = undefined;
  answers.environmentDefaults = [];
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
