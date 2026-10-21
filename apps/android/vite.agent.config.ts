import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Un solo archivo IIFE, sin imports, para inyectarlo en cada página del WebView.
// La condición `source` toma el TypeScript de @hackaton/contracts sin compilarlo.
export default defineConfig({
  resolve: { conditions: ['source'] },
  build: {
    outDir: resolve(__dirname, 'app/src/main/assets'),
    emptyOutDir: false,
    minify: true,
    target: 'chrome111',
    lib: {
      entry: resolve(__dirname, 'web/page-agent.ts'),
      formats: ['iife'],
      name: 'GuiamePageAgent',
      fileName: () => 'page-agent.js',
    },
  },
});
