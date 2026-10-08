import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Dev: Vite on 5180 (host: true so LAN devices can reach it), proxying the API and
// the Socket.IO endpoint to the game server on 4777.
export default defineConfig({
  root: here('./src/client'),
  plugins: [react()],
  build: {
    outDir: here('./dist/client'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    proxy: {
      '/api': 'http://localhost:4777',
      '/socket.io': { target: 'http://localhost:4777', ws: true },
    },
  },
  preview: { port: 5180, host: true },
});
