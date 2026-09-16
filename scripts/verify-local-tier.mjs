/**
 * A full end-to-end run through the CONSOLE on the on-device tier.
 *
 * The Gate 2 harness proves the planner works; this proves the whole product
 * does — the real console, the real reader, the real validator, the real
 * executor, driven by Qwen2.5-1.5B on WebGPU with the model loaded through the
 * UI exactly as a user would.
 *
 * Uses a persistent profile on a FIXED port, because the model cache is
 * per-origin and a random port throws it away every run.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps/demo/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 4321;

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(dist, rel === '/' ? 'index.html' : rel);
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(path.join(root, '.shots'), { recursive: true });

const context = await chromium.launchPersistentContext(path.join(root, '.demo-profile'), {
  headless: false,
  ignoreDefaultArgs: ['--disable-gpu'],
  args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu'],
  viewport: { width: 1400, height: 940 },
});
const page = context.pages()[0] ?? (await context.newPage());
page.on('pageerror', (e) => console.log('PAGE ERROR:', String(e).slice(0, 180)));

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForSelector('.tiffin');

console.log('\nLoading the on-device model through the UI ("Demo mode")...');
const t0 = Date.now();
await page.click('button:has-text("Demo mode")');

// Report the real progress the UI is showing, so a long download is visibly
// working rather than apparently hung.
const progress = setInterval(() => {
  void page
    .evaluate(() => {
      const pct = [...document.querySelectorAll('button')].find((b) => /^\d+%$/.test(b.textContent ?? ''));
      const note = [...document.querySelectorAll('.note')].find((n) => (n.textContent ?? '').includes('Fetching'));
      return pct?.textContent ?? note?.textContent?.slice(0, 70) ?? null;
    })
    .then((text) => text && process.stdout.write(`\r  ${text}`.padEnd(80)))
    .catch(() => undefined);
}, 2000);

await page.waitForFunction(
  () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Demo ready')),
  undefined,
  { timeout: 900_000 },
);
clearInterval(progress);
console.log(`\n  model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const stripAfterLoad = await page.evaluate(() =>
  (document.querySelector('.status')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
);
console.log(`  strip: ${stripAfterLoad}`);

const goal = process.argv[2] ?? 'biryani search karo aur check karo ki biryani wale restaurants mile';
console.log(`\nRunning on the LOCAL tier: "${goal}"`);
await page.fill('textarea', goal);
const t1 = Date.now();
await page.locator('button.btn-primary', { hasText: 'Run' }).click();

let ringBadges = new Set();
const watcher = setInterval(() => {
  void page
    .evaluate(() => document.querySelector('.ring-badge')?.textContent ?? null)
    .then((b) => b && ringBadges.add(b))
    .catch(() => undefined);
}, 150);

await page.waitForSelector('.verdict', { timeout: 300_000 });
clearInterval(watcher);
const elapsed = Date.now() - t1;

const out = await page.evaluate(() => ({
  verdict: document.querySelector('.verdict-tag')?.textContent ?? '?',
  reason: document.querySelector('.verdict-reason')?.textContent ?? '',
  meta: document.querySelector('.verdict-meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  strip: (document.querySelector('.status')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  steps: [...document.querySelectorAll('.row')].map((r) => ({
    n: r.querySelector('.row-n')?.textContent,
    reason: r.querySelector('.row-reason')?.textContent,
    json: r.querySelector('.row-json')?.textContent,
    meta: r.querySelector('.row-meta')?.textContent,
  })),
  insets: [...document.querySelectorAll('.row-inset')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim().slice(0, 150)),
}));

console.log(`\nVERDICT: ${out.verdict} — ${out.reason}`);
console.log(`         ${out.meta}  ·  wall clock ${(elapsed / 1000).toFixed(1)}s`);
console.log(`STRIP:   ${out.strip}`);
console.log(`RING badges seen: ${[...ringBadges].join(', ') || 'NONE'}`);
console.log('\nSTEPS:');
for (const s of out.steps) console.log(`  ${s.n}  ${s.reason}\n      ${s.json}   [${s.meta}]`);
if (out.insets.length) {
  console.log('\nINSET ROWS:');
  for (const i of out.insets) console.log(`  · ${i}`);
}

await page.screenshot({ path: '.shots/local-tier-run.png' });
await context.close();
server.close();
