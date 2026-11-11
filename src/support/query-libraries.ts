export type QueryFramework = 'vue' | 'react';

export type QueryLibraryId =
  'vue-query' | 'pinia-colada' | 'swrv' | 'react-query' | 'swr' | 'rtk-query';

export type QueryPackage = { name: string; range: string };

export type QueryLibrary = {
  id: QueryLibraryId;
  framework: QueryFramework;
  label: string;
  /** Packages added to `dependencies`; the first one is what a project declares when it uses the library. */
  packages: QueryPackage[];
  /** What the lint messages tell developers to use instead of `fetch`. */
  usage: string;
};

export const QUERY_LIBRARIES: readonly QueryLibrary[] = [
  {
    id: 'vue-query',
    framework: 'vue',
    label: 'TanStack Query for Vue',
    packages: [{ name: '@tanstack/vue-query', range: '^5.0.0' }],
    usage: 'useQuery / useMutation from @tanstack/vue-query',
  },
  {
    id: 'pinia-colada',
    framework: 'vue',
    label: 'Pinia Colada',
    packages: [
      { name: '@pinia/colada', range: '^1.0.0' },
      { name: 'pinia', range: '^3.0.0' },
    ],
    usage: 'useQuery / useMutation from @pinia/colada',
  },
  {
    id: 'swrv',
    framework: 'vue',
    label: 'swrv',
    packages: [{ name: 'swrv', range: '^1.0.0' }],
    usage: 'useSWRV from swrv',
  },
  {
    id: 'react-query',
    framework: 'react',
    label: 'TanStack Query for React',
    packages: [{ name: '@tanstack/react-query', range: '^5.0.0' }],
    usage: 'useQuery / useMutation from @tanstack/react-query',
  },
  {
    id: 'swr',
    framework: 'react',
    label: 'SWR',
    packages: [{ name: 'swr', range: '^2.0.0' }],
    usage: 'useSWR / useSWRMutation from swr',
  },
  {
    id: 'rtk-query',
    framework: 'react',
    label: 'RTK Query',
    packages: [
      { name: '@reduxjs/toolkit', range: '^2.0.0' },
      { name: 'react-redux', range: '^9.0.0' },
    ],
    usage: 'the RTK Query hooks from @reduxjs/toolkit/query/react',
  },
];

export const DEFAULT_QUERY_LIBRARY: Record<QueryFramework, QueryLibraryId> = {
  vue: 'vue-query',
  react: 'react-query',
};

export const isQueryLibraryId = (value: string): value is QueryLibraryId =>
  QUERY_LIBRARIES.some(({ id }) => id === value);

export const queryLibrary = (id: QueryLibraryId): QueryLibrary => {
  const found = QUERY_LIBRARIES.find((library) => library.id === id);
  if (!found) {
    throw new Error(`Unknown query library: ${id}`);
  }
  return found;
};

/** Raw HTTP clients that are banned next to `fetch`. */
export const HTTP_CLIENT_PACKAGES = [
  'axios',
  'ky',
  'got',
  'superagent',
  'node-fetch',
  'ofetch',
] as const;

export const DEFAULT_QUERY_ALLOW = ['src/support/http/**'];
