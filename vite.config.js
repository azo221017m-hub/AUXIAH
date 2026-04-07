import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.HELPER_ALIAS': JSON.stringify(process.env.helper_alias || ''),
    'import.meta.env.HELPER_TELEFONO': JSON.stringify(process.env.helper_telefono || ''),
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
