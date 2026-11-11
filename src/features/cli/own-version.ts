import { existsSync, readFileSync } from 'node:fs';

/** The version of this package, read from its own package.json (source and built layouts). */
export const ownVersion = (): string => {
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
