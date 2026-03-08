import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/PolaCoacher2/',
  server: {
    port: 5173,
    proxy: {
      '/PolaCoacher2/api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/PolaCoacher2/, ''),
      },
      '/PolaCoacher2/uploads': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/PolaCoacher2/, ''),
      },
      '/PolaCoacher2/covers': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/PolaCoacher2/, ''),
      },
      '/PolaCoacher2/audio': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/PolaCoacher2/, ''),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
