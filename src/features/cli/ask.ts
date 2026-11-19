import { styleText } from 'node:util';
import * as clack from '@clack/prompts';

/** The clack prompts, with the label (message) in bold so it stands apart from the input. */
const bold = (message: string): string => styleText('bold', message);

export const text = (options: clack.TextOptions): Promise<string | symbol> =>
  clack.text({ ...options, message: bold(options.message) });

export const select = <Value>(options: clack.SelectOptions<Value>): Promise<Value | symbol> =>
  clack.select({ ...options, message: bold(options.message) });

export const multiselect = <Value>(
  options: clack.MultiSelectOptions<Value>,
): Promise<Value[] | symbol> => clack.multiselect({ ...options, message: bold(options.message) });

export const confirm = (options: clack.ConfirmOptions): Promise<boolean | symbol> =>
  clack.confirm({ ...options, message: bold(options.message) });
