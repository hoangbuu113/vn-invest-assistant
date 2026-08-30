import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'server/index.js',
    outDir: 'dist/server',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js'
      }
    }
  }
});
