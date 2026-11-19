import { styleText } from 'node:util';
import { MultiLinePrompt, settings, wrapTextWithPrefix, type CANCEL_SYMBOL } from '@clack/core';
import { S_BAR, S_BAR_END, symbol } from '@clack/prompts';

export type MultilineOptions = {
  message: string;
  initialValue?: string;
  placeholder?: string;
  validate?: (value: string | undefined) => string | undefined;
  /** Mentions in the hint that Esc goes back, instead of cancelling. */
  back?: boolean;
};

const INPUT_INDENT = '  ';

const hintText = ({ back }: MultilineOptions): string =>
  back ? 'Press Enter twice to continue, Esc to go back' : 'Press Enter twice to continue';

const placeholderText = (placeholder: string | undefined): string =>
  placeholder
    ? styleText('inverse', placeholder.slice(0, 1)) + styleText('dim', placeholder.slice(1))
    : styleText(['inverse', 'hidden'], '_');

/** Renders like the clack multiline prompt, with a muted hint under the input. */
const renderFrame = (
  prompt: Omit<MultiLinePrompt, 'prompt'>,
  options: MultilineOptions,
): string => {
  const guide = settings.withGuide;
  const head = `${guide ? `${styleText('gray', S_BAR)}\n` : ''}${symbol(prompt.state)}  ${styleText('bold', options.message)}\n`;
  const hint = styleText('dim', hintText(options));
  const value = prompt.value ?? '';
  const wrap = (
    text: string,
    color: 'gray' | 'cyan' | 'yellow',
    style?: (line: string) => string,
  ) =>
    guide
      ? wrapTextWithPrefix(
          undefined,
          text,
          `${styleText(color, S_BAR)}  ${INPUT_INDENT}`,
          undefined,
          undefined,
          style,
        )
      : text;
  const input = prompt.userInput
    ? prompt.userInputWithCursor
    : placeholderText(options.placeholder);
  switch (prompt.state) {
    case 'error': {
      const error = styleText('yellow', prompt.error);
      return `${head}${wrap(input, 'yellow')}\n${styleText('yellow', S_BAR_END)}  ${error}\n${guide ? '   ' : ''}${hint}\n`;
    }
    case 'submit': {
      return `${head}${wrap(value, 'gray', (line) => styleText('dim', line))}`;
    }
    case 'cancel': {
      return `${head}${wrap(value, 'gray', (line) => styleText(['strikethrough', 'dim'], line))}`;
    }
    default: {
      const end = guide ? `${styleText('cyan', S_BAR_END)}  ` : '';
      return `${head}${wrap(input, 'cyan')}\n${end}${hint}\n`;
    }
  }
};

/** The clack multiline prompt, with a muted hint under the input about how to submit. */
export class HintedMultiLinePrompt extends MultiLinePrompt {
  constructor(options: MultilineOptions) {
    super({
      initialValue: options.initialValue,
      placeholder: options.placeholder,
      validate: options.validate,
      render() {
        return renderFrame(this, options);
      },
    });
  }
}

/** Asks for multi-line text: submit with a double Enter. Resolves to the cancel symbol on Esc. */
export const multiline = async (
  options: MultilineOptions,
): Promise<string | typeof CANCEL_SYMBOL> =>
  (await new HintedMultiLinePrompt(options).prompt()) ?? '';
