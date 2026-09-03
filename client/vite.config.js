import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
          if (id.includes('/node_modules/@supabase/')) return 'supabase';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
});
