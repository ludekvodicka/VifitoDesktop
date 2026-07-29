import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const root = import.meta.dirname

export default defineConfig({
  main: {
    build: {
      outDir: resolve(root, 'out/main'),
      rollupOptions: {
        // electron-updater stays external so electron-builder ships it from node_modules;
        // bundling it would pull in its dynamic requires.
        external: ['electron', 'electron-updater'],
        input: { index: resolve(root, 'src/main/index.ts') },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      outDir: resolve(root, 'out/preload'),
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(root, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: { input: { index: resolve(root, 'src/renderer/index.html') } },
    },
  },
})
