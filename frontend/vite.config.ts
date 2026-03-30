import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 3023,
    allowedHosts: ['openinvoice.angelstreet.io'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5023',
        changeOrigin: true,
      },
    },
  },
});
