import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': apiOrigin,
      '/apps': apiOrigin,
    },
  },
});
