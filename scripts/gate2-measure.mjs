/**
 * Gate 2: does a 1B model actually hold this?
 *
 * Loads the real weights in a real browser on real WebGPU, then issues planning
 * calls against real Tiffin screens and runs every reply through the REAL
 * validator. Reports the invalid-output rate broken down by screen, because the
 * 580-token restaurant screen was flagged as the drift risk and an averaged
 * number would hide exactly the thing we need to know.
 *
 *   node scripts/gate2-measure.mjs [callsPerScreen] [--offline]
 *
 * The browser profile is persistent, so the model cache survives between runs —
 * which is what makes the offline test meaningful rather than theatre.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'tooling/gate2/dist');
const profileDir = path.join(root, '.webgpu-profile');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

const callsPerScreen = Number(process.argv[2] ?? 5);
const offline = process.argv.includes('--offline');

/**
 * Cross-origin isolation mode, and a finding worth recording.
 *
 * The first run of this harness set COEP: require-corp on the assumption that
 * WebGPU needs cross-origin isolation. It does NOT — and require-corp actively
 * BREAKS WebLLM, because the model weights are fetched from a cross-origin CDN
 * that does not send a CORP header, so the fetch is blocked and the page dies
 * mid-download.
 *
 * `credentialless` is the mode that gives isolation without blocking those
 * fetches. `off` is what we actually need for this demo. Step 12's deploy config
 * must use one of those two, never require-corp.
 */
const COEP = process.env.ORIGO_COEP ?? 'off';

/** Fixed, so the model cache survives between runs. See serve(). */
const ORIGO_PORT = Number(process.env.ORIGO_PORT ?? 4317);

async function serve(dir) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.join(dir, rel === '/' ? 'index.html' : rel);
    try {
      const body = await readFile(file);
      const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' };
      if (COEP !== 'off') {
        headers['Cross-Origin-Opener-Policy'] = 'same-origin';
        headers['Cross-Origin-Embedder-Policy'] = COEP;
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  // A FIXED PORT, deliberately.
  //
  // The browser caches model weights per ORIGIN, and a random port is a new
  // origin every run — so every run re-downloaded 633MB and the "does it work
  // offline" test could never pass. Same lesson as any cache: the key has to be
  // stable or the cache is decorative.
  await new Promise((r) => server.listen(ORIGO_PORT, '127.0.0.1', r));
  return { server, port: ORIGO_PORT };
}

/** The goals, one per screen, phrased the way a user would phrase them. */
const PLAN_CASES = [
  { screenId: 'search', goal: 'search for biryani' },
  { screenId: 'results', goal: 'open the first restaurant in the results' },
  { screenId: 'restaurant', goal: 'add the first item to the cart' },
  { screenId: 'cart', goal: 'check the cart total is under 500' },
  { screenId: 'checkout', goal: 'check the delivery address is set' },
];

async function main() {
  if (!existsSync(dist)) {
    console.error('Build the harness first:  npx vite build tooling/gate2');
    process.exit(1);
  }
  await mkdir(profileDir, { recursive: true });
  await mkdir(path.join(root, '.shots'), { recursive: true });

  const { server, port } = await serve(dist);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    ignoreDefaultArgs: ['--disable-gpu'],
    args: [
      '--enable-unsafe-webgpu',
      // Without this Chrome hands out the integrated GPU, whose buffer limits
      // are too small for a 1B model — the renderer dies mid-load with no
      // error, which is exactly what happened the first time this ran.
      '--force_high_performance_gpu',
    ],
    viewport: { width: 420, height: 780 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  browser error:', m.text().slice(0, 160));
  });
  page.on('crash', () => console.log('  *** THE RENDERER CRASHED — almost always GPU memory ***'));
  page.on('pageerror', (e) => console.log('  page error:', String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.tiffin');

  console.log(`COEP mode: ${COEP}`);
  const probe = await page.evaluate(() => globalThis.__gate2.probe());
  console.log(`\nWebGPU: ${probe.available ? 'available' : 'NOT AVAILABLE'} — ${probe.reason}`);
  if (!probe.available) {
    await context.close();
    server.close();
    process.exit(1);
  }

  if (offline) {
    // The real test of the offline claim: cut the network BEFORE loading, so
    // anything not already cached simply cannot be fetched.
    await context.setOffline(true);
    console.log('NETWORK: forced offline before loading the model.');
  }

  console.log('\nLoading the model (cold start if the cache is empty)...');
  const ticker = setInterval(() => {
    page
      .evaluate(() => globalThis.__gate2.progress())
      .then((p) => {
        if (p) process.stdout.write(`\r  ${Math.round(p.progress * 100)}% ${p.text.slice(0, 88)}`.padEnd(110));
      })
      .catch(() => undefined);
  }, 1500);

  const load = await page.evaluate(() => globalThis.__gate2.load());
  clearInterval(ticker);
  process.stdout.write(`\r${' '.repeat(110)}\r`);
  console.log(`  ${load.ok ? 'loaded' : 'FAILED'} in ${(load.ms / 1000).toFixed(1)}s — ${load.message}`);
  if (!load.ok) {
    await context.close();
    server.close();
    process.exit(1);
  }

  const navigate = {
    search: async () => {
      await page.evaluate(() => globalThis.__gate2.reset());
      await page.waitForTimeout(250);
    },
    results: async () => {
      await page.evaluate(() => globalThis.__gate2.reset());
      await page.waitForTimeout(150);
      await page.fill('input[type="search"]', 'biryani');
      await page.waitForTimeout(250);
    },
    restaurant: async () => {
      await navigate.results();
      await page.click('.t-card');
      await page.waitForTimeout(250);
    },
    cart: async () => {
      await navigate.restaurant();
      await page.click('.t-add');
      await page.waitForTimeout(150);
      await page.click('[aria-label^="Cart,"]');
      await page.waitForTimeout(250);
    },
    checkout: async () => {
      await navigate.cart();
      await page.click('.t-primary');
      await page.waitForTimeout(300);
    },
  };

  const attempts = [];
  for (const testCase of PLAN_CASES) {
    await navigate[testCase.screenId]();
    const screen = await page.evaluate((id) => globalThis.__gate2.read(id), testCase.screenId);
    console.log(`\n${testCase.screenId} — ${screen.nodes} nodes, ${screen.tokens} est. tokens`);
    console.log(`  goal: "${testCase.goal}"`);

    for (let i = 0; i < callsPerScreen; i += 1) {
      const attempt = await page.evaluate(
        ([goal, id]) => globalThis.__gate2.plan(goal, id),
        [testCase.goal, testCase.screenId],
      );
      attempts.push(attempt);
      const mark = attempt.ok ? 'ok  ' : 'BAD ';
      const what = attempt.ok ? attempt.actionType : `${attempt.stage}/${attempt.fault}: ${(attempt.message ?? '').slice(0, 68)}`;
      console.log(`    ${mark} ${String(attempt.latencyMs).padStart(6)}ms  ${what}`);
      if (!attempt.ok) console.log(`         raw: ${attempt.raw.replace(/\n/g, ' ').slice(0, 108)}`);
    }
  }

  await context.close();
  server.close();

  console.log('\n' + '-'.repeat(92));
  console.log('GATE 2 - on-device planning, per screen\n');
  console.log('screen        calls  valid  invalid  rate    mean ms   p50 ms   max ms   screen tok');
  console.log('-'.repeat(92));

  for (const testCase of PLAN_CASES) {
    const rows = attempts.filter((a) => a.screenId === testCase.screenId);
    if (rows.length === 0) continue;
    const valid = rows.filter((a) => a.ok).length;
    const times = rows.map((a) => a.latencyMs).filter((n) => n > 0).sort((a, b) => a - b);
    const mean = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const p50 = times.length ? times[Math.floor(times.length / 2)] : 0;
    console.log(
      `${testCase.screenId.padEnd(13)} ${String(rows.length).padStart(5)} ${String(valid).padStart(6)} ${String(rows.length - valid).padStart(8)}  ${String(Math.round(((rows.length - valid) / rows.length) * 100)).padStart(3)}%  ${String(mean).padStart(8)} ${String(p50).padStart(8)} ${String(times.at(-1) ?? 0).padStart(8)} ${String(rows[0].screenTokens).padStart(12)}`,
    );
  }

  const valid = attempts.filter((a) => a.ok).length;
  const allTimes = attempts.map((a) => a.latencyMs).filter((n) => n > 0);
  console.log('-'.repeat(92));
  console.log(
    `TOTAL ${attempts.length} calls · ${valid} valid · ${attempts.length - valid} invalid · ` +
      `${Math.round(((attempts.length - valid) / attempts.length) * 100)}% invalid-output rate`,
  );
  if (allTimes.length) {
    console.log(`mean planning latency ${Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length)}ms · max ${Math.max(...allTimes)}ms`);
  }

  const failures = attempts.filter((a) => !a.ok);
  if (failures.length) {
    console.log('\nWHY THE INVALID ONES FAILED:');
    const byReason = new Map();
    for (const f of failures) {
      const key = `${f.stage}/${f.fault}`;
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} x ${reason}`);
  }

  await writeFile(path.join(root, '.shots/gate2.json'), JSON.stringify(attempts, null, 2), 'utf8');
  console.log('\nraw attempts written to .shots/gate2.json\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
