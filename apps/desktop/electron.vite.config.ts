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
      // index: barra e inicio (ventana). card: tarjeta flotante de ayuda (vista sobre el sitio).
      // site-check: panel de Protección de sitios (vista sobre el sitio, debajo del indicador).
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          card: resolve('src/renderer/card.html'),
          'site-check': resolve('src/renderer/site-check.html'),
        },
      },
    },
  },
});
