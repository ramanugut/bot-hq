import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = process.env.BOTLY_API ?? process.env.GROKBOT_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../server/src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false, ws: true },
    },
  },
  // noVNC uses top-level await, so target ES2022+.
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Libraries change far less often than the app: a separate file stays cached across Botly updates.
        manualChunks(id) {
          if (!id.includes('node_modules') || id.includes('@novnc')) return undefined;
          return /[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id) ? 'react' : 'vendor';
        },
      },
    },
  },
});
