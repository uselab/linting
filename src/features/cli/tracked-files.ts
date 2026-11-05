import { existsSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { gitAdd, gitMove } from './git';

/** Writes and moves the files of a project, remembering the new ones to stage them in git. */
export type TrackedFiles = {
  projectDir: string;
  /** Writes a file (relative to the project or absolute), remembering it when it is new. */
  write: (file: string, content: string) => void;
  /** Renames with `git mv` so the rename is staged, or a plain rename when git can't move it. */
  move: (from: string, to: string) => void;
  /** Stages the new and moved files, warning about the ones git can't add (e.g. ignored files). */
  stage: () => void;
};

const toProjectPath = (projectDir: string, file: string): string =>
  path.relative(projectDir, file).split(path.sep).join('/');

const stageFiles = (projectDir: string, files: string[]): void => {
  const existing = [...new Set(files)].filter((file) => existsSync(file));
  const failed = existing.filter((file) => !gitAdd(projectDir, file));
  const added = existing.filter((file) => !failed.includes(file));
  const list = (paths: string[]): string =>
    paths.map((file) => toProjectPath(projectDir, file)).join(', ');
  if (added.length > 0) {
    clack.log.success(`Added ${list(added)} to git.`);
  }
  if (failed.length > 0) {
    clack.log.warn(`Could not add ${list(failed)} to git (ignored?). Add them by hand if needed.`);
  }
};

export const trackFiles = (projectDir: string): TrackedFiles => {
  const newFiles: string[] = [];
  return {
    projectDir,
    write: (file, content) => {
      const absolutePath = path.resolve(projectDir, file);
      if (!existsSync(absolutePath)) {
        newFiles.push(absolutePath);
      }
      writeFileSync(absolutePath, content);
    },
    move: (from, to) => {
      if (!gitMove(projectDir, from, to)) {
        renameSync(path.join(projectDir, from), path.join(projectDir, to));
      }
      newFiles.push(path.join(projectDir, to));
      clack.log.success(`Renamed ${from} to ${to}.`);
    },
    stage: () => stageFiles(projectDir, newFiles),
  };
};
