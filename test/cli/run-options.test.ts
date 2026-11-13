import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { answers, commitAndInit, dir, mocks, read, readEslintConfig } from './run-harness';

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
    expect(mocks.runAnalyze).toHaveBeenCalledWith(dir, true, {
      intro: false,
      commits: expect.anything(),
    });
  });

  it('offers npm install first when init changed the dependencies', async () => {
    answers.analyze = true;

    await commitAndInit(dir);

    expect(answers.analyzePrompts[1]).toBe(
      'The analysis needs the dependencies installed. Run npm install first?',
    );
    expect(mocks.runInstall).toHaveBeenCalledWith(dir, 'npm install');
    expect(mocks.runAnalyze).toHaveBeenCalledWith(dir, true, {
      intro: false,
      commits: expect.anything(),
    });
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

  it('leaves non-literal globalIgnores() unchanged without asking', async () => {
    const text = [
      "import { javascriptPreset, browserPreset, nodePreset } from '@uselab/linting';",
      "import { globalIgnores } from 'eslint/config';",
      "const skipped = ['legacy/**'];",
      '',
      'export default [',
      '  globalIgnores(skipped),',
      '  ...javascriptPreset(),',
      "  ...browserPreset({ files: ['src/**'] }),",
      "  ...nodePreset({ ignores: ['src/**'] }),",
      '];',
      '',
    ].join('\n');
    rmSync(path.join(dir, 'eslint.config.js'));
    writeFileSync(path.join(dir, CONFIG), text);

    await initWithScope('exclude', 'other/**');

    expect(read(CONFIG)).toBe(text);
    expect(answers.warnings.some((warning) => warning.includes('globalIgnores()'))).toBe(true);
  });
});

describe('run init environment', () => {
  const CONFIG = 'eslint.config.mts';

  const initEnvironment = async (): Promise<string> => {
    answers.presets = ['javascript'];
    answers.confirm = false;
    await commitAndInit(dir);
    return read(CONFIG);
  };

  it('scopes the browser globals to the src folders of a browser project', async () => {
    const config = await initEnvironment();

    expect(answers.environmentDefaults).toEqual(['browser', 'src/**']);
    expect(config).toContain("...browserPreset({ files: ['src/**'] }),");
    expect(config).toContain("...nodePreset({ ignores: ['src/**'] }),");
  });

  it('writes the edited browser globs', async () => {
    answers.browserFiles = 'apps/web/src/**, apps/admin/src/**';

    const config = await initEnvironment();

    expect(config).toContain(
      "...browserPreset({ files: ['apps/web/src/**', 'apps/admin/src/**'] }),",
    );
    expect(config).toContain(
      "...nodePreset({ ignores: ['apps/web/src/**', 'apps/admin/src/**'] }),",
    );
  });

  it('gives a node project node globals everywhere without asking for globs', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'api', dependencies: { express: '^5.0.0' } }, undefined, 2),
    );

    const config = await initEnvironment();

    expect(answers.environmentDefaults).toEqual(['node']);
    expect(config).toContain('...nodePreset(),');
    expect(config).not.toContain('browserPreset');
  });

  it('preselects the existing environment', async () => {
    rmSync(path.join(dir, 'eslint.config.js'));
    writeFileSync(
      path.join(dir, CONFIG),
      [
        "import { javascriptPreset, browserPreset, nodePreset } from '@uselab/linting';",
        '',
        'export default [',
        '  ...javascriptPreset(),',
        "  ...browserPreset({ files: ['web/**'] }),",
        "  ...nodePreset({ ignores: ['web/**'] }),",
        '];',
        '',
      ].join('\n'),
    );

    const existing = await initEnvironment();

    expect(existing).toContain("...browserPreset({ files: ['web/**'] }),");
    expect(answers.environmentDefaults).toEqual(['browser', 'web/**']);
  });
});
