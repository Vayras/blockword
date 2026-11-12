import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.BLOCKWORD_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
});
