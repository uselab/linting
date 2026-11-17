import type { Config, Rules } from '../../support/shared';

const isWarn = (level: unknown): boolean => level === 'warn' || level === 1;

const withoutWarning = (entry: Rules[string]): Rules[string] => {
  if (Array.isArray(entry)) {
    const [level, ...options] = entry;
    return isWarn(level) ? ['off', ...options] : entry;
  }
  return isWarn(entry) ? 'off' : entry;
};

/**
 * Wraps the whole config and sets every rule with severity `warn` to `off`, keeping the options.
 * Use it as the outermost call, so it sees the rules of all presets and your own entries.
 */
export const disableWarnings = (configs: Config[]): Config[] =>
  configs.map((config) =>
    config.rules
      ? {
          ...config,
          rules: Object.fromEntries(
            Object.entries(config.rules).map(([rule, entry]) => [rule, withoutWarning(entry)]),
          ),
        }
      : config,
  );
