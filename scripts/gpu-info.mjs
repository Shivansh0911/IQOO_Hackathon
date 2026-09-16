/**
 * Which GPU does Chrome actually hand WebGPU, and how much can it hold?
 *
 * Worth its own script: on this laptop Chrome defaults to the integrated GPU
 * even when a discrete one exists, and that single fact changes on-device
 * inference from usable to unusable. The Android equivalent is MediaPipe
 * silently falling back from GPU to CPU — same lesson, same need to READ the
 * backend rather than assume it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><body>gpu probe</body></html>');
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

for (const [name, args] of [
  ['default', ['--enable-unsafe-webgpu']],
  ['forced high performance', ['--enable-unsafe-webgpu', '--force_high_performance_gpu']],
]) {
  const browser = await chromium.launch({ headless: false, ignoreDefaultArgs: ['--disable-gpu'], args });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const info = await page.evaluate(async (pref) => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: pref });
    if (!adapter) return null;
    const i = adapter.info ?? {};
    return {
      vendor: i.vendor ?? '?',
      architecture: i.architecture ?? '?',
      device: i.device ?? '',
      description: i.description ?? '',
      maxBufferMB: Math.round(adapter.limits.maxBufferSize / 1e6),
      maxStorageMB: Math.round(adapter.limits.maxStorageBufferBindingSize / 1e6),
    };
  }, 'high-performance');
  console.log(`${name.padEnd(24)} ${info ? `${info.vendor}/${info.architecture} ${info.device}${info.description} · maxBuffer ${info.maxBufferMB}MB · maxStorageBinding ${info.maxStorageMB}MB` : 'no adapter'}`);
  await browser.close();
}
server.close();
