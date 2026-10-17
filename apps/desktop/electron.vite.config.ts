import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Todo se empaqueta en los bundles: los paquetes del workspace exportan TypeScript
// y los preloads con sandbox no pueden cargar módulos de node_modules.
// La condición `source` toma el TypeScript de @hackaton/contracts sin compilarlo.
const source = { conditions: ['source'] };

export default defineConfig({
  main: {
    resolve: source,
    ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
    build: { externalizeDeps: false },
  },
  preload: {
    resolve: source,
    ssr: { resolve: { conditions: ['source'] } },
    build: {
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        input: {
          ui: resolve('src/preload/ui.ts'),
          page: resolve('src/preload/page/index.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: source,
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
});
