export * from 'src/router';

export const load = async (): Promise<unknown> => import('/src/main.css');

export const theme = async (): Promise<unknown> => import('/src/support/theme.css');

