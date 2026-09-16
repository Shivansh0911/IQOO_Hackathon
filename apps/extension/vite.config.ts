import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Only the side panel is built by Vite; the two scripts are bundled by esbuild. */
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: false },
});
