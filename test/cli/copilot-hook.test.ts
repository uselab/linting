import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPILOT_HOOK_STDIN_MESSAGE,
  copilotHookConfig,
  editedFiles,
  lintEditedFiles,
  projectFiles,
  runCopilotHook,
} from '../../src/features/cli/copilot-hook';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'uselab-hook-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('editedFiles', () => {
  it('reads the path of edit and create tools, also from a JSON string', () => {
    expect(editedFiles({ cwd: dir, toolArgs: { path: 'src/a.ts', old_str: 'a' } })).toEqual([
      path.join(dir, 'src', 'a.ts'),
    ]);
    expect(
      editedFiles({ cwd: dir, toolArgs: JSON.stringify({ path: path.join(dir, 'b.ts') }) }),
    ).toEqual([path.join(dir, 'b.ts')]);
  });

  it('reads the added, updated and moved files of a patch', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+x',
      '*** Update File: src/old.ts',
      '*** Move to: src/moved.ts',
      '*** Delete File: src/gone.ts',
      '*** End Patch',
    ].join('\n');
    const expected = ['new.ts', 'old.ts', 'moved.ts'].map((file) => path.join(dir, 'src', file));
    expect(editedFiles({ cwd: dir, toolArgs: patch })).toEqual(expected);
    expect(editedFiles({ cwd: dir, toolArgs: { input: patch } })).toEqual(expected);
  });

  it('ignores the view command and missing paths', () => {
    expect(editedFiles({ cwd: dir, toolArgs: { command: 'view', path: 'a.ts' } })).toEqual([]);
    expect(editedFiles({ cwd: dir, toolArgs: {} })).toEqual([]);
  });
});

describe('projectFiles', () => {
  it('keeps the existing files inside the project, as real paths', () => {
    const projectDir = path.join(dir, 'app');
    mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    writeFileSync(path.join(projectDir, 'src', 'a.ts'), '');
    writeFileSync(path.join(dir, 'outside.ts'), '');
    const files = ['src/a.ts', 'src/missing.ts', 'src', '../outside.ts'].map((file) =>
      path.resolve(projectDir, file),
    );

    expect(projectFiles(projectDir, files)).toEqual([
      realpathSync.native(path.join(projectDir, 'src', 'a.ts')),
    ]);
  });
});

describe('runCopilotHook', () => {
  it('fails instead of waiting when stdin is a terminal', async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await runCopilotHook(dir);

    expect(write).toHaveBeenCalledWith(`${COPILOT_HOOK_STDIN_MESSAGE}\n`);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    write.mockRestore();
    if (isTTY) {
      Object.defineProperty(process.stdin, 'isTTY', isTTY);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });
});

describe('copilotHookConfig', () => {
  it('only sets cwd for a project in a subdirectory', () => {
    expect(JSON.parse(copilotHookConfig(undefined)).hooks.postToolUse[0]).not.toHaveProperty('cwd');
    expect(JSON.parse(copilotHookConfig('packages/web')).hooks.postToolUse[0].cwd).toBe(
      'packages/web',
    );
  });
});

describe('lintEditedFiles', () => {
  const write = (file: string, content: string): string => {
    const absolutePath = path.join(dir, file);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
    return absolutePath;
  };

  beforeEach(() => {
    write(
      'eslint.config.mjs',
      "export default [{ rules: { 'no-var': 'error', 'no-undef': 'error' } }];\n",
    );
    write('.prettierrc.json', '{ "singleQuote": true }\n');
  });

  it('formats and fixes the file and returns ok', async () => {
    const file = write('src/a.js', 'var  a = "x"\nexport { a }\n');

    expect(await lintEditedFiles(dir, [file])).toBe(
      'uselab-linting: ok\nAuto-fixed/formatted src/a.js; view the file before editing it again.',
    );
    expect(readFileSync(file, 'utf8')).toBe("let a = 'x';\nexport { a };\n");
  });

  it('lists the errors that remain', async () => {
    const file = write('src/b.js', 'export const b = 1;\nfoo(b);\n');

    expect(await lintEditedFiles(dir, [file])).toBe(
      "uselab-linting: 1 lint error(s) remain after autofix:\nsrc/b.js:2:1  'foo' is not defined.  (no-undef)",
    );
  });
});
