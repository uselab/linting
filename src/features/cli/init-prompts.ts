import * as clack from '@clack/prompts';
import { detectBrowserFiles, detectSrcDirs, detectTestFiles, type Detection } from './detect';
import type { ExistingConfig } from './eslint-config';
import { orderPresets, type InitAnswers } from './generate';
import { askAnswers } from './prompts';
import { findSourceTsconfigs } from './tsconfig';

export type ExistingEslintConfig = { file: string; config: ExistingConfig };

/** Shows why the presets and the project type were preselected. */
const noteDetection = (detection: Detection, existing: ExistingEslintConfig | undefined): void => {
  const lines = [
    `project type: ${detection.projectType} (${detection.projectTypeReason})`,
    ...Object.entries(detection.reasons).map(([preset, reason]) => `${preset}: ${reason ?? ''}`),
  ];
  if (existing) {
    lines.push('', `Also preselected the presets and project type of ${existing.file}.`);
  }
  clack.note(lines.join('\n'), 'Detected');
};

/** The project type and browser globs of an existing config, else the detected ones. */
const initialEnvironment = ({
  projectDir,
  detection,
  existing,
  detectedTestFiles,
}: {
  projectDir: string;
  detection: Detection;
  existing: ExistingConfig | undefined;
  detectedTestFiles: string[];
}) => {
  const environment = existing?.environment;
  const initialBrowserFiles =
    environment?.type === 'browser' && environment.browserFiles.length > 0
      ? environment.browserFiles
      : detectBrowserFiles(projectDir, existing?.javascript?.testFiles ?? detectedTestFiles);
  return { initialProjectType: environment?.type ?? detection.projectType, initialBrowserFiles };
};

/** Asks for the presets, preselecting the detected ones and those of an existing config. */
export const askPresets = async (
  projectDir: string,
  detection: Detection,
  existing: ExistingEslintConfig | undefined,
): Promise<InitAnswers> => {
  noteDetection(detection, existing);
  const detectedTestFiles = detectTestFiles(projectDir);
  return askAnswers({
    initialPresets: orderPresets([...detection.presets, ...(existing?.config.presets ?? [])]),
    ...initialEnvironment({ projectDir, detection, existing: existing?.config, detectedTestFiles }),
    boundariesDefaults: {
      projectDir,
      srcDirs: detectSrcDirs(projectDir),
      tsconfigsFor: (srcDirs) => findSourceTsconfigs(projectDir, srcDirs).map(({ file }) => file),
    },
    detectedTestFiles,
    initialJavascript: existing?.config.javascript,
    initialBoundaries: existing?.config.boundaries,
    initialQuery: existing?.config.query,
    detectedQueryLibrary: detection.queryLibrary,
    initialIgnores: existing?.config.ignores,
    ignoresEditable: existing?.config.ignoresEditable ?? true,
  });
};
