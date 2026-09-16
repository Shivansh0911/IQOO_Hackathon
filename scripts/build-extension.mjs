/**
 * Builds the Chrome extension.
 *
 * Three artefacts with three different constraints, which is why this is a
 * script and not one Vite config:
 *   - the side panel is an ordinary Vite app
 *   - the content script must be an IIFE (MV3 content scripts cannot be modules)
 *   - the service worker must be an ES module (the manifest declares it as one)
 */

import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const app = path.join(root, 'apps/extension');
const dist = path.join(app, 'dist');

const alias = {
  '@origo/core': path.join(root, 'packages/core/src/index.ts'),
  '@origo/agent': path.join(root, 'packages/agent/src/index.ts'),
  '@origo/planner': path.join(root, 'packages/planner/src/index.ts'),
  '@origo/report': path.join(root, 'packages/report/src/index.ts'),
  '@origo/adapter-web': path.join(root, 'adapters/web/src/index.ts'),
  '@origo/adapter-extension': path.join(root, 'adapters/extension/src/index.ts'),
};

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await viteBuild({
    root: app,
    logLevel: 'error',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      target: 'es2022',
      // The panel is sidepanel.html, not index.html, so the entry is explicit.
      rollupOptions: { input: path.join(app, 'sidepanel.html') },
    },
  });

  await esbuild({
    entryPoints: [path.join(app, 'src/content.ts')],
    outfile: path.join(dist, 'content.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    alias,
  });

  await esbuild({
    entryPoints: [path.join(app, 'src/background.ts')],
    outfile: path.join(dist, 'background.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    alias,
  });

  await copyFile(path.join(app, 'manifest.json'), path.join(dist, 'manifest.json'));

  console.log(`\nExtension built to apps/extension/dist`);
  console.log('Load it: chrome://extensions → Developer mode → Load unpacked → apps/extension/dist\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
