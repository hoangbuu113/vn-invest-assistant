import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sites } from '@openai/sites-vite-plugin';

export default defineConfig({
  plugins: [react(), sites()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/framer-motion/')) return 'framer';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
});
