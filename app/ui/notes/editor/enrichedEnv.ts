// A lib de Markdown do Channels lê um `__DEV__` global (do React Native). O Channels define no Vite; aqui fica num
// módulo importado antes da lib, para valer também no `bun test` (T2983).
const g = globalThis as { __DEV__?: boolean };
g.__DEV__ ??= false;

export {};
