import { routes } from './router';

export const start = (): string => routes.join(',') || 'app';

