import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import {
  ESLINT_CONFIGS,
  findExistingTooling,
  removeExistingTooling,
  TOOLING_FILES,
} from './cleanup';
import {
  findCommonJsUsages,
  MODULE_TYPE_MAX_USAGES,
  moduleTypeNote,
  refactorReport,
  REFACTOR_REPORT_FILE,
  reportWrittenMessage,
} from './commonjs';
import {
  COPILOT_HOOK_FILE,
  copilotHookConfig,
  findRepositoryRoot,
  runCopilotHook,
} from './copilot-hook';
import {
  checkDependencies,
  compareVersions,
  installCommand,
  isModulePackage,
  minimumOfRange,
  needsUpdate,
  nodeTypesRange,
  patchPackageJson,
  requiredDependencies,
  setModuleType,
  type DependencyCheck,
  type PackageJson,
  type Requirement,
} from './dependencies';
import { detectPresets, detectSrcDirs, type Detection } from './detect';
import { checkGit } from './git';
import { type TrackedFiles, trackFiles } from './tracked-files';
import {
  readEslintConfig,
  updateEslintConfig,
  type ConfigUpdate,
  type ExistingConfig,
} from './eslint-config';
import {
  eslintConfigFile,
  generateEslintConfig,
  generatePrettierConfig,
  orderPresets,
  PRETTIER_CONFIG_FILES,
  prettierConfigFile,
  SHARED_PRETTIER_CONFIG,
  type InitAnswers,
  type PresetId,
} from './generate';
import { askAnswers, confirm } from './prompts';
import { addScripts, checkScripts, findStaleScripts, requiredScripts } from './scripts';
import {
  checkImplicitAny,
  disallowImplicitAny,
  findSourceTsconfig,
  findSourceTsconfigs,
  NODE_TSCONFIG,
  setupNodeTsconfig,
} from './tsconfig';
import { typecheckScript, updateViteChecker } from './typecheck';
import { findViteConfig, viteConfigNeedsNodeTypes } from './vite';
import { updateSourceTsconfigs, updateViteConfig } from './aliases';

export const USAGE = `Usage: uselab-linting init [dir]
       uselab-linting copilot-hook

Sets up @uselab/linting in a project. Detects the framework to preselect presets, replaces any
existing lint/format tooling and applies the setup without further questions. The directory must
be inside a git repository without uncommitted changes.

  dir            Target project directory (default: current directory)
  copilot-hook   GitHub Copilot postToolUse hook: formats and lint-fixes the edited files
                 (JSON payload on stdin) and reports the remaining errors to the agent`;

type ProjectPackage = { text: string; data: PackageJson & Record<string, unknown> };

const readPackageJson = (projectDir: string): ProjectPackage | undefined => {
  const file = path.join(projectDir, 'package.json');
  if (!existsSync(file)) {
    return undefined;
  }
  const text = readFileSync(file, 'utf8');
  return { text, data: JSON.parse(text) };
};

const ownVersion = (): string => {
  for (const candidate of ['../package.json', '../../../package.json']) {
    const file = new URL(candidate, import.meta.url);
    if (existsSync(file)) {
      const data: { name?: string; version?: string } = JSON.parse(readFileSync(file, 'utf8'));
      if (data.name === '@uselab/linting' && data.version) {
        return data.version;
      }
    }
  }
  return '1.0.0';
};

const writeFile = (tracked: TrackedFiles, file: string, content: string): void => {
  tracked.write(file, content);
  clack.log.success(`Wrote ${file}.`);
};

/**
 * Offers to set `"type": "module"` in package.json, listing the CommonJS code that would break.
 * Returns the (possibly updated) package.json.
 */
const updateModuleType = async (
  projectDir: string,
  project: ProjectPackage | undefined,
): Promise<ProjectPackage | undefined> => {
  if (!project || isModulePackage(project.data)) {
    return project;
  }
  const usages = findCommonJsUsages(projectDir, TOOLING_FILES);
  clack.note(moduleTypeNote(project.data.type, usages), '"type": "module"');
  const initialValue = usages.length <= MODULE_TYPE_MAX_USAGES;
  if (!(await confirm('Set "type": "module" in package.json?', initialValue))) {
    return project;
  }
  writeFileSync(path.join(projectDir, 'package.json'), setModuleType(project.text));
  clack.log.success('Set "type": "module" in package.json.');
  if (usages.length > 0) {
    writeFileSync(path.join(projectDir, REFACTOR_REPORT_FILE), refactorReport(usages));
    clack.log.warn(reportWrittenMessage(usages));
  }
  return readPackageJson(projectDir);
};

type ExistingEslintConfig = { file: string; config: ExistingConfig };

/** Finds an ESLint config that already uses `@uselab/linting`, to preselect its presets. */
const findExistingEslintConfig = (projectDir: string): ExistingEslintConfig | undefined => {
  for (const file of ESLINT_CONFIGS) {
    const absolutePath = path.join(projectDir, file);
    const config = existsSync(absolutePath)
      ? readEslintConfig(readFileSync(absolutePath, 'utf8'))
      : undefined;
    if (config) {
      return { file, config };
    }
  }
  return undefined;
};

/** Shows why the presets were preselected. */
const noteDetection = (
  reasons: Partial<Record<PresetId, string>>,
  existing: ExistingEslintConfig | undefined,
): void => {
  const lines = Object.entries(reasons).map(([preset, reason]) => `${preset}: ${reason ?? ''}`);
  if (existing) {
    lines.push('', `Also preselected the presets of ${existing.file}.`);
  }
  clack.note(lines.join('\n'), 'Detected');
};

const EDITABLE_PRESETS: { preset: PresetId; editable: keyof ExistingConfig }[] = [
  { preset: 'javascript', editable: 'javascriptEditable' },
  { preset: 'boundaries', editable: 'boundariesEditable' },
];

/** Warns about options of an updated config that couldn't be rewritten or were dropped. */
const warnConfigUpdate = (configFile: string, answers: InitAnswers, update: ConfigUpdate): void => {
  const updated = readEslintConfig(update.code);
  for (const { preset, editable } of EDITABLE_PRESETS) {
    if (answers.presets.includes(preset) && updated?.[editable] === false) {
      clack.log.warn(`The ${preset}() options in ${configFile} aren't literals; left unchanged.`);
    }
  }
  if (updated?.ignoresEditable === false) {
    clack.log.warn(
      updated.ignoresLegacy
        ? `configs.ignores() no longer exists and its patterns in ${configFile} aren't literals; replace it by globalIgnores([...]) from 'eslint/config'.`
        : `The globalIgnores() patterns in ${configFile} aren't literals or mix opt-in and opt-out; left unchanged.`,
    );
  }
  if (update.boundariesRemovedOptions.length > 0) {
    clack.log.warn(
      `Removed boundaries() options that no longer exist from ${configFile}: ${update.boundariesRemovedOptions.join(', ')}. The project structure (app / features / support, guided by the principles of Domain-Driven Design) is fixed; use srcDirs for the src folders.`,
    );
  }
};

/**
 * Updates an existing `@uselab/linting` config in place, keeping custom entries. Returns false
 * when the file isn't such a config (so it should be written from scratch instead).
 */
const updateExistingEslintConfig = (
  projectDir: string,
  configFile: string,
  answers: InitAnswers,
): boolean => {
  const target = path.join(projectDir, configFile);
  const text = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  const update = text === undefined ? undefined : updateEslintConfig(text, answers);
  if (!update) {
    return false;
  }
  warnConfigUpdate(configFile, answers, update);
  const changes = [
    ...update.added.map((preset) => `+ ${preset}`),
    ...update.removed.map((preset) => `- ${preset}`),
    ...(update.javascriptUpdated ? ['~ javascript()'] : []),
    ...(update.boundariesUpdated ? ['~ boundaries options'] : []),
    ...(update.ignoresMigrated ? ['~ configs.ignores() → globalIgnores()'] : []),
    ...(update.ignoresUpdated && !update.ignoresMigrated ? ['~ globalIgnores()'] : []),
  ];
  if (changes.length === 0) {
    clack.log.info(`${configFile} already uses the selected presets.`);
    return true;
  }
  writeFileSync(target, update.code);
  clack.note(changes.join('\n'), `Updated ${configFile} (other entries are kept)`);
  return true;
};

/** Moves an existing `@uselab/linting` config to the target file name, so it can be updated. */
const moveExistingEslintConfig = (
  tracked: TrackedFiles,
  existing: ExistingEslintConfig | undefined,
  configFile: string,
): void => {
  if (existing && existing.file !== configFile) {
    tracked.move(existing.file, configFile);
  }
};

/** Whether the file exists and extends the shared Prettier config (so it may be customised). */
const usesSharedPrettierConfig = (projectDir: string, file: string): boolean => {
  const absolutePath = path.join(projectDir, file);
  return (
    existsSync(absolutePath) && readFileSync(absolutePath, 'utf8').includes(SHARED_PRETTIER_CONFIG)
  );
};

/** Moves an existing generated Prettier config to the target file name, keeping its overrides. */
const moveExistingPrettierConfig = (tracked: TrackedFiles, prettierFile: string): void => {
  const { projectDir } = tracked;
  const existing = PRETTIER_CONFIG_FILES.find(
    (file) => file !== prettierFile && usesSharedPrettierConfig(projectDir, file),
  );
  if (!existing || existsSync(path.join(projectDir, prettierFile))) {
    return;
  }
  tracked.move(existing, prettierFile);
};

type ConfigFiles = { eslint: string; prettier: string };

const writeConfigs = (tracked: TrackedFiles, files: ConfigFiles, answers: InitAnswers): void => {
  if (!updateExistingEslintConfig(tracked.projectDir, files.eslint, answers)) {
    writeFile(tracked, files.eslint, generateEslintConfig(answers));
  }
  if (!answers.presets.includes('prettier')) {
    return;
  }
  if (usesSharedPrettierConfig(tracked.projectDir, files.prettier)) {
    clack.log.info(`${files.prettier} already extends ${SHARED_PRETTIER_CONFIG}; kept.`);
    return;
  }
  writeFile(tracked, files.prettier, generatePrettierConfig());
};

const describeCheck = (check: DependencyCheck): string =>
  check.status === 'missing'
    ? `${check.name}: added ${check.range} (${check.reason})`
    : `${check.name}: ${check.declared ?? ''} → ${check.range} (${check.reason})`;

const warnOutdatedInstalls = (projectDir: string, checks: DependencyCheck[]): void => {
  for (const check of checks.filter(({ status }) => status === 'ok')) {
    const file = path.join(projectDir, 'node_modules', check.name, 'package.json');
    const installed = existsSync(file)
      ? minimumOfRange(JSON.parse(readFileSync(file, 'utf8')).version ?? '')
      : undefined;
    const required = minimumOfRange(check.minVersion);
    if (installed && required && compareVersions(installed, required) < 0) {
      clack.log.warn(`Installed ${check.name} is older than ${check.minVersion}; run npm install.`);
    }
  }
};

/**
 * Adds or updates what the ESLint config needs (eslint + jiti, ...) in package.json. Returns
 * whether package.json was changed, or the install command when there is no package.json.
 */
const updateDependencies = (
  projectDir: string,
  requirements: Requirement[],
  project: ProjectPackage | undefined,
): boolean | string => {
  if (!project) {
    clack.log.warn('No package.json found. The ESLint config needs eslint and jiti installed.');
    return installCommand(requirements);
  }
  const checks = checkDependencies(project.data, requirements);
  for (const check of checks.filter(({ status }) => status === 'unverifiable')) {
    clack.log.warn(
      `Can't verify ${check.name}@${check.declared ?? ''}; needs >= ${check.minVersion}.`,
    );
  }
  warnOutdatedInstalls(projectDir, checks);
  const updates = checks.filter(needsUpdate);
  if (updates.length === 0) {
    clack.log.success('package.json already has the required dependencies.');
    return false;
  }
  writeFileSync(path.join(projectDir, 'package.json'), patchPackageJson(project.text, checks));
  clack.note(updates.map(describeCheck).join('\n'), 'Updated package.json dependencies');
  return true;
};

/** Writes the lint, format and typecheck scripts, overwriting existing ones with another command. */
const updateScripts = (
  projectDir: string,
  answers: InitAnswers,
  project: ProjectPackage | undefined,
): void => {
  if (!project) {
    return;
  }
  const required = requiredScripts(answers.presets, typecheckScript(projectDir, answers));
  const checks = checkScripts(project.data.scripts, required);
  const changes = checks.filter(({ status }) => status !== 'ok');
  if (changes.length > 0) {
    const text = addScripts(project.text, project.data.scripts !== undefined, changes);
    writeFileSync(path.join(projectDir, 'package.json'), text);
    const list = changes.map(({ name, command, declared }) =>
      declared === undefined ? `+ ${name}: ${command}` : `~ ${name}: ${declared} → ${command}`,
    );
    clack.note(list.join('\n'), 'Updated package.json scripts');
  }
  const stale = findStaleScripts(project.data.scripts, Object.keys(required));
  if (stale.length > 0) {
    clack.log.warn(
      `These scripts still use removed lint/format tools: ${stale.join(', ')}. Update or remove them.`,
    );
  }
};

/**
 * A TypeScript Vite config importing Node builtins (e.g. `node:url` for the aliases) needs
 * `@types/node`, loaded by its tsconfig. Returns the `@types/node` range to require, if needed.
 */
const updateNodeTypes = (
  tracked: TrackedFiles,
  project: ProjectPackage | undefined,
): string | undefined => {
  const { projectDir } = tracked;
  const viteConfig = findViteConfig(projectDir);
  if (!viteConfig || !viteConfigNeedsNodeTypes(viteConfig.file, viteConfig.text)) {
    return undefined;
  }
  const result = setupNodeTsconfig(projectDir, viteConfig.file);
  if (result.status === 'manual') {
    clack.log.warn(
      `${result.file} includes ${viteConfig.file} via a glob. If Node types are missing there, move it to a ${NODE_TSCONFIG} with "types": ["node"].`,
    );
  }
  if (result.status === 'updated') {
    for (const { absolutePath, text } of result.writes) {
      tracked.write(absolutePath, text);
    }
    const files = result.writes.map(({ file }) => file).join('\n');
    clack.note(
      files,
      result.split
        ? `Moved ${viteConfig.file} to ${NODE_TSCONFIG} (Node types)`
        : `Added "node" types for ${viteConfig.file}`,
    );
  }
  return nodeTypesRange(project?.data);
};

/** Offers to set `"noImplicitAny": true` in each source tsconfig that allows implicit `any`. */
const updateImplicitAny = async (projectDir: string, answers: InitAnswers): Promise<void> => {
  const srcDirs = answers.boundaries?.srcDirs ?? ['src'];
  for (const tsconfig of findSourceTsconfigs(projectDir, srcDirs)) {
    const status = checkImplicitAny(projectDir, tsconfig);
    if (status === 'unknown') {
      clack.log.info(
        `Can't verify noImplicitAny in ${tsconfig.file} (unresolved "extends"); make sure implicit any is not allowed.`,
      );
    }
    if (
      status === 'allowed' &&
      (await confirm(`${tsconfig.file} allows implicit any. Set "noImplicitAny": true?`))
    ) {
      writeFileSync(tsconfig.absolutePath, disallowImplicitAny(tsconfig.text));
      clack.log.success(`Set "noImplicitAny": true in ${tsconfig.file}.`);
    }
  }
};

/** Writes the Copilot hook to the repository root, running in the project directory. */
const writeCopilotHook = (tracked: TrackedFiles): void => {
  const { projectDir } = tracked;
  const root = findRepositoryRoot(projectDir);
  const cwd = path.relative(root, projectDir).split(path.sep).join('/');
  const file = path.join(root, COPILOT_HOOK_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  tracked.write(file, copilotHookConfig(cwd || undefined));
  clack.log.success(`Wrote ${path.relative(projectDir, file).split(path.sep).join('/')}.`);
};

const printNextSteps = (projectDir: string, install: string | undefined): void => {
  const hasLintScript = readPackageJson(projectDir)?.data.scripts?.lint !== undefined;
  const steps = [install, hasLintScript ? 'npm run lint' : 'npx eslint .'].filter(
    (step) => step !== undefined,
  );
  clack.note(steps.join('\n'), 'Next steps');
};

const isDirectory = (dir: string): boolean => existsSync(dir) && statSync(dir).isDirectory();

const fail = (message: string): void => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

/** Asks for the presets, preselecting the detected ones and those of an existing config. */
const askPresets = async (
  projectDir: string,
  detection: Detection,
  existing: ExistingEslintConfig | undefined,
): Promise<InitAnswers> => {
  noteDetection(detection.reasons, existing);
  return askAnswers({
    initialPresets: orderPresets([...detection.presets, ...(existing?.config.presets ?? [])]),
    boundariesDefaults: {
      projectDir,
      srcDirs: detectSrcDirs(projectDir),
      tsconfigsFor: (srcDirs) => findSourceTsconfigs(projectDir, srcDirs).map(({ file }) => file),
    },
    initialJavascript: existing?.config.javascript,
    initialBoundaries: existing?.config.boundaries,
    initialIgnores: existing?.config.ignores,
    ignoresEditable: existing?.config.ignoresEditable ?? true,
  });
};

const installStep = (
  dependencies: boolean | string,
  removedPackages: boolean,
): string | undefined => {
  if (typeof dependencies === 'string') {
    return dependencies;
  }
  return dependencies || removedPackages ? 'npm install' : undefined;
};

const init = async (projectDir: string): Promise<void> => {
  clack.log.info(`Target: ${projectDir}`);
  const project = readPackageJson(projectDir);
  const tsconfig = findSourceTsconfig(projectDir);
  const existing = findExistingEslintConfig(projectDir);
  const answers = await askPresets(
    projectDir,
    detectPresets(projectDir, project?.data, tsconfig?.file),
    existing,
  );

  const updatedProject = await updateModuleType(projectDir, project);
  const copilotHook = await confirm(
    'Add a GitHub Copilot hook that formats and lint-fixes files after the agent edits them?',
  );
  const isModule = isModulePackage(updatedProject?.data);
  const files: ConfigFiles = {
    eslint: eslintConfigFile(isModule),
    prettier: prettierConfigFile(isModule),
  };
  const tracked = trackFiles(projectDir);
  moveExistingEslintConfig(tracked, existing, files.eslint);
  moveExistingPrettierConfig(tracked, files.prettier);
  const report = findExistingTooling(projectDir, updatedProject?.data, [
    files.eslint,
    files.prettier,
  ]);
  removeExistingTooling(projectDir, report, updatedProject?.text);
  writeConfigs(tracked, files, answers);

  if (answers.presets.includes('aliases')) {
    updateSourceTsconfigs(projectDir, answers);
    updateViteConfig(projectDir);
  }
  if (answers.presets.includes('typescript')) {
    await updateImplicitAny(projectDir, answers);
  }
  const viteChecker = updateViteChecker(projectDir, answers, tsconfig);
  const nodeTypes = updateNodeTypes(tracked, readPackageJson(projectDir));
  const dependencies = updateDependencies(
    projectDir,
    requiredDependencies(answers.presets, ownVersion(), { nodeTypes, viteChecker }),
    readPackageJson(projectDir),
  );
  updateScripts(projectDir, answers, readPackageJson(projectDir));
  if (copilotHook) {
    writeCopilotHook(tracked);
  }
  tracked.stage();
  printNextSteps(projectDir, installStep(dependencies, report.dependencies.length > 0));
  clack.outro('Done.');
};

const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

const runInit = async (dir: string | undefined): Promise<void> => {
  const projectDir = path.resolve(dir ?? process.cwd());
  if (!isDirectory(projectDir)) {
    fail(`Target directory does not exist: ${projectDir}`);
    return;
  }
  const gitError = checkGit(projectDir);
  if (gitError) {
    fail(gitError);
    return;
  }
  clack.intro('@uselab/linting');
  await init(projectDir);
};

/** Entry point of the CLI. */
export const run = async (argv: string[]): Promise<void> => {
  const [command, dir] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (command === 'copilot-hook') {
    await runCopilotHook();
    return;
  }
  if (command === undefined && isInteractive()) {
    await runInit(undefined);
    return;
  }
  if (command === 'init') {
    await runInit(dir);
    return;
  }
  fail(USAGE);
};
