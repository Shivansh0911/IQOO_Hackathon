import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // WebGPU in a cross-origin-isolated context. Tier 1 silently degrades
    // without these, and it degrades in production while working locally —
    // which is why step 12 verifies the DEPLOYED status strip, not this one.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: { target: 'es2022' },
});
