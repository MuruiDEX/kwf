import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Temporary smoke-stack config (deleted after the run): same app, different
// ports, API proxy pointed at the smoke backend on :8001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:8001' },
  },
});
