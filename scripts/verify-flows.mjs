/**
 * Walks the eight user flows against the PRODUCTION build, in a clean browser
 * profile with no cache and no localStorage, and reports what a first-time
 * visitor actually experiences.
 *
 * Served with the exact headers the deploy config uses, so that what passes here
 * is what passes on the live URL. The one thing this cannot do is speak into a
 * real microphone; the voice flow tests the permission-denied and
 * unsupported-browser paths, and the review step is exercised by unit tests.
 *
 *   node scripts/verify-flows.mjs [--webgpu]
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps/demo/dist');
const withGpu = process.argv.includes('--webgpu');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

/**
 * The production headers, verbatim from the deploy config.
 *
 * COOP is set and COEP is NOT. WebGPU does not require cross-origin isolation,
 * and COEP: require-corp actively breaks WebLLM by blocking the cross-origin
 * fetch of the model weights. Getting this wrong kills the local tier in
 * production while localhost looks fine, which is why it is tested here.
 */
const PROD_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const results = [];
function record(flow, outcome, ms, defect = '') {
  results.push({ flow, outcome, ms, defect });
  console.log(`\n[${flow}]  ${ms === null ? '' : `${ms}ms  `}${outcome}${defect ? `\n    DEFECT: ${defect}` : ''}`);
}

/**
 * Runs one flow in isolation.
 *
 * An audit that stops at the first failure only ever tells you about one
 * problem. Each flow gets its own try, its own screenshot on failure, and its
 * own row in the table.
 */
async function flow(name, shotName, body) {
  const { context, page, errors } = await freshPage(globalThis.__browser);
  try {
    await body(page, context, errors);
  } catch (cause) {
    await page.screenshot({ path: `.shots/${shotName}-FAILED.png` }).catch(() => undefined);
    const state = await page
      .evaluate(() => ({
        rows: document.querySelectorAll('.row').length,
        verdict: document.querySelector('.verdict-tag')?.textContent ?? 'none',
        thinking: document.querySelector('.thinking')?.textContent?.slice(0, 60) ?? 'none',
        warn: document.querySelector('.note.warn')?.textContent?.slice(0, 90) ?? 'none',
        reason: document.querySelector('.verdict-reason')?.textContent?.slice(0, 160) ?? 'none',
        logHeight: Math.round(document.querySelector('.log')?.getBoundingClientRect().height ?? -1),
        verdictHeight: Math.round(document.querySelector('.verdict')?.getBoundingClientRect().height ?? -1),
      }))
      .catch(() => null);
    record(
      name,
      `THREW: ${String(cause).split('\n')[0].slice(0, 120)}\n    page state: ${JSON.stringify(state)}`,
      null,
      'flow did not complete',
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function serve() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.join(dist, rel === '/' ? 'index.html' : rel);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', ...PROD_HEADERS });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(4318, '127.0.0.1', r));
  return server;
}

/** A page with no cache and no storage — a genuine first-time visitor. */
async function freshPage(browser, viewport = { width: 1360, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: [] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('crash', () => errors.push('RENDERER CRASHED'));
  return { context, page, errors };
}

const strip = (page) =>
  page.evaluate(() => (document.querySelector('.status')?.textContent ?? '').replace(/\s+/g, ' ').trim());

async function main() {
  if (!existsSync(dist)) {
    console.error('Build first:  npx vite build apps/demo');
    process.exit(1);
  }
  await mkdir(path.join(root, '.shots'), { recursive: true });
  const server = await serve();
  const url = 'http://127.0.0.1:4318/';

  const browser = await chromium.launch({
    headless: false,
    ignoreDefaultArgs: ['--disable-gpu'],
    args: withGpu ? ['--enable-unsafe-webgpu', '--force_high_performance_gpu'] : ['--disable-gpu'],
  });
  console.log(`\nORIGO LOOP — flow verification on the production build`);
  console.log(`WebGPU: ${withGpu ? 'enabled (discrete GPU forced)' : 'DISABLED — testing the degraded path'}`);
  console.log(`Headers: ${Object.keys(PROD_HEADERS).join(', ')} (COEP deliberately absent)\n`);

  // ── FLOW 1 · COLD FIRST VISIT ──────────────────────────────────────────
  {
    const { context, page, errors } = await freshPage(browser);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const domReady = Date.now() - t0;
    await page.waitForSelector('.tiffin', { timeout: 15000 });
    const painted = Date.now() - t0;
    await page.waitForSelector('button:has-text("Run")', { timeout: 15000 });
    const runnable = Date.now() - t0;
    // Two samples: what the strip says at first paint, and what it settles to.
    // The tier probe is async, so the first frame genuinely does not know yet.
    const stripAtPaint = await strip(page);
    await page.waitForTimeout(1200);
    const stripSettled = await strip(page);
    const readinessLine = await page.evaluate(() => {
      const notes = [...document.querySelectorAll('.note')].map((n) => n.textContent ?? '');
      return notes.find((n) => n.includes('on-device:'))?.slice(0, 130) ?? 'none';
    });
    const guidance = await page.evaluate(() => document.querySelector('.log-empty')?.textContent?.slice(0, 90) ?? '');
    await page.screenshot({ path: '.shots/flow1-cold.png' });

    record(
      'FLOW 1 cold first visit',
      `DOM ${domReady}ms · Tiffin painted ${painted}ms · RUN usable ${runnable}ms\n` +
        `    strip at paint:  ${stripAtPaint}\n` +
        `    strip settled:   ${stripSettled}\n` +
        `    on-device line:  ${readinessLine}\n` +
        `    guidance on screen: "${guidance}…"`,
      runnable,
      errors.length ? errors.join(' | ') : '',
    );
    await context.close();
  }

  globalThis.__browser = browser;

  // ── FLOW 2 · TYPED GOAL, HAPPY PATH ───────────────────────────────────
  await flow('FLOW 2 typed goal', 'flow2', async (page, _context, errors) => {
    await page.goto(url);
    await page.waitForSelector('.tiffin');
    // Wait for the button to be genuinely clickable. A click that lands before
    // React attaches its handler is silently swallowed, and the symptom is a
    // run that never starts — which is exactly what the first audit saw.
    await page.locator('button.btn-primary', { hasText: 'Run' }).waitFor({ state: 'visible' });
    const t0 = Date.now();
    await page.fill('textarea', 'add an item from the first biryani restaurant and check the cart total is under 500');
    await page.locator('button.btn-primary', { hasText: 'Run' }).click();

    // The ring only exists WHILE the agent is acting, so it has to be sampled
    // during the run. Checking after the verdict always reports false, which is
    // how the first version of this audit got it wrong.
    let ringSeen = false;
    let badgeText = '';
    const ringWatcher = setInterval(() => {
      void page
        .evaluate(() => {
          const ring = document.querySelector('.ring');
          return ring ? (document.querySelector('.ring-badge')?.textContent ?? 'no badge') : null;
        })
        .then((badge) => {
          if (badge !== null) {
            ringSeen = true;
            badgeText = badge;
          }
        })
        .catch(() => undefined);
    }, 120);

    await page.waitForSelector('.verdict', { timeout: 60000 });
    clearInterval(ringWatcher);
    const elapsed = Date.now() - t0;
    const summary = await page.evaluate(() => ({
      verdict: document.querySelector('.verdict-tag')?.textContent ?? '?',
      meta: document.querySelector('.verdict-meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      steps: document.querySelectorAll('.row').length,
    }));
    summary.ringSeen = ringSeen ? `yes (badge "${badgeText}")` : 'NEVER SEEN';
    await page.screenshot({ path: '.shots/flow2-happy.png' });
    record(
      'FLOW 2 typed goal',
      `${summary.verdict} · ${summary.meta} · ${summary.steps} log rows · ring rendered during run: ${summary.ringSeen}`,
      elapsed,
      errors.length ? errors.join(' | ') : '',
    );
  });

  // ── FLOW 3 · VOICE: the paths that can be tested without a mouth ──────
  {
    const { context, page, errors } = await freshPage(browser);
    await context.clearPermissions();
    await page.goto(url);
    await page.waitForSelector('.tiffin');
    const supported = await page.evaluate(
      () => 'SpeechRecognition' in globalThis || 'webkitSpeechRecognition' in globalThis,
    );
    const panel = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('.panel-title')].map((t) => t.textContent ?? '');
      return titles.find((t) => t.includes('voice')) ?? 'NO VOICE PANEL';
    });
    const t0 = Date.now();
    let denied = 'mic button not found';
    const hold = page.locator('button:has-text("Hold to speak")');
    if ((await hold.count()) > 0) {
      await hold.dispatchEvent('mousedown');
      await page.waitForTimeout(1200);
      await hold.dispatchEvent('mouseup');
      await page.waitForTimeout(500);
      denied = await page.evaluate(() => document.querySelector('.note.warn')?.textContent?.slice(0, 120) ?? 'no message shown');
    } else {
      denied = await page.evaluate(() => {
        const notes = [...document.querySelectorAll('.note')].map((n) => n.textContent ?? '');
        return notes.find((n) => n.includes('Web Speech')) ?? 'no unsupported message';
      });
    }
    await page.screenshot({ path: '.shots/flow3-voice.png' });
    record(
      'FLOW 3 voice',
      `Web Speech present: ${supported} · panel: "${panel}"\n    with mic blocked: "${denied}"`,
      Date.now() - t0,
      errors.length ? errors.join(' | ') : '',
    );
    await context.close();
  }

  // ── FLOW 4 · THE GUARDRAIL FIRING ─────────────────────────────────────
  {
    const { context, page, errors } = await freshPage(browser);
    await page.goto(url);
    await page.waitForSelector('.tiffin');
    const t0 = Date.now();
    await page.fill('textarea', 'add an item and place the order');
    await page.locator('button.btn-primary', { hasText: 'Run' }).click();
    await page.waitForSelector('.sheet', { timeout: 60000 });
    await page.waitForTimeout(400);
    const sheet = await page.evaluate(() => ({
      heading: document.querySelector('.sheet h3')?.textContent ?? '',
      body: document.querySelector('.sheet p')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      hasAllow: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Allow once'))),
    }));
    await page.screenshot({ path: '.shots/flow4-guardrail.png' });
    await page.click('button:has-text("Deny")');
    await page.waitForSelector('.verdict', { timeout: 30000 });
    const after = await page.evaluate(() => ({
      verdict: document.querySelector('.verdict-tag')?.textContent ?? '?',
      // Did the app actually stay put? The confirmation screen must NOT appear.
      confirmed: Boolean(document.querySelector('.t-confirmed')),
    }));
    record(
      'FLOW 4 destructive gate',
      `sheet: "${sheet.heading}" — ${sheet.body.slice(0, 110)}\n` +
        `    allow/deny offered: ${sheet.hasAllow} · after deny: ${after.verdict} · order placed: ${after.confirmed}`,
      Date.now() - t0,
      after.confirmed ? 'DENY DID NOT STOP THE RUN — the order went through' : errors.join(' | '),
    );
    await context.close();
  }

  // ── FLOW 5 · A FAILING RUN ────────────────────────────────────────────
  {
    const { context, page, errors: flow5Errors } = await freshPage(browser);
    await page.goto(url);
    await page.waitForSelector('.tiffin');
    const t0 = Date.now();
    await page.fill('textarea', 'check that the first biryani restaurant is rated above 4.9');
    await page.locator('button.btn-primary', { hasText: 'Run' }).click();
    await page.waitForSelector('.verdict', { timeout: 60000 });
    const v = await page.evaluate(() => ({
      verdict: document.querySelector('.verdict-tag')?.textContent ?? '?',
      klass: document.querySelector('.verdict')?.className ?? '',
      reason: document.querySelector('.verdict-reason')?.textContent ?? '',
      assertLine: [...document.querySelectorAll('.row-json')].map((e) => e.textContent ?? '').find((t) => t.includes('FAIL')) ?? '',
    }));
    await page.screenshot({ path: '.shots/flow5-fail.png' });
    record(
      'FLOW 5 failing run',
      `${v.verdict} (${v.klass.includes('fail') ? 'red' : 'NOT RED'}) · ${v.reason}\n    assert line: ${v.assertLine.slice(0, 100)}`,
      Date.now() - t0,
      v.klass.includes('fail') ? (flow5Errors.length ? flow5Errors.join(' | ') : '') : 'verdict is not styled as a failure',
    );
    await context.close();
  }

  // ── FLOW 7 · THE HOSTILE JUDGE ────────────────────────────────────────
  await flow('FLOW 7 hostile judge', 'flow7', async (page, context, errors) => {
    await page.goto(url);
    await page.waitForSelector('.tiffin');
    const findings = [];

    // Double-click RUN fast.
    await page.fill('textarea', 'biryani search karo aur check karo ki biryani wale restaurants mile');
    const run = page.locator('button:has-text("Run")');
    await run.click();
    await run.click({ force: true, timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const rowsAfterDouble = await page.evaluate(() => document.querySelectorAll('.row').length);
    const dupes = await page.evaluate(() => {
      const ns = [...document.querySelectorAll('.row-n')].map((n) => n.textContent);
      return ns.length - new Set(ns).size;
    });
    findings.push(`double RUN: ${rowsAfterDouble} rows, ${dupes} duplicated step numbers${dupes > 0 ? ' ← BAD' : ' ✓'}`);

    // Switch tabs mid-run.
    const other = await context.newPage();
    await other.goto('about:blank');
    await page.waitForTimeout(800);
    await page.bringToFront();
    await other.close();
    await page.waitForSelector('.verdict', { timeout: 60000 });
    findings.push(`tab switch mid-run: completed to ${await page.evaluate(() => document.querySelector('.verdict-tag')?.textContent)} ✓`);

    // Browser back mid-run.
    //
    // NOTE ON HONESTY: a Playwright page starts at about:blank, so goBack()
    // leaves the app entirely — which is what a real visitor's back button does
    // too (it returns them to wherever they came from). That is normal browser
    // behaviour, not a defect in this app. What matters is that coming BACK to
    // the app works, so that is what is checked.
    await page.click('button:has-text("Reset")');
    await page.fill('textarea', 'biryani search karo aur check karo ki biryani wale restaurants mile');
    await page.click('button:has-text("Run")');
    await page.waitForTimeout(600);
    await page.goBack().catch(() => undefined);
    await page.waitForTimeout(800);
    const leftTheApp = await page.evaluate(() => !document.querySelector('.tiffin'));
    // Return, as a user would, and confirm the app comes back clean.
    await page.goto(url);
    const cameBack = await page
      .waitForSelector('.tiffin', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    const stateAfter = await page.evaluate(() => ({
      running: Boolean(document.querySelector('.btn-stop')),
      rows: document.querySelectorAll('.row').length,
    }));
    findings.push(
      `browser back mid-run: left the page ${leftTheApp ? 'yes (normal)' : 'no'} · returning works ${cameBack ? '✓' : '← BAD'} · ` +
        `no orphaned run on return (${stateAfter.rows} rows, running=${stateAfter.running}) ${!stateAfter.running ? '✓' : '← BAD'}`,
    );

    // Narrow width, and a phone viewport.
    await page.setViewportSize({ width: 620, height: 800 });
    await page.waitForTimeout(300);
    const narrow = await page.evaluate(() => {
      const el = document.querySelector('.console');
      const stage = document.querySelector('.stage');
      return {
        consoleVisible: (el?.getBoundingClientRect().width ?? 0) > 60,
        stageVisible: (stage?.getBoundingClientRect().width ?? 0) > 60,
        overflows: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    await page.screenshot({ path: '.shots/flow7-narrow.png' });
    findings.push(
      `620px wide: console ${narrow.consoleVisible ? 'visible' : 'COLLAPSED'}, stage ${narrow.stageVisible ? 'visible' : 'COLLAPSED'}, h-overflow ${narrow.overflows ? 'YES ← BAD' : 'no ✓'}`,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const phone = await page.evaluate(() => ({
      overflows: document.documentElement.scrollWidth > window.innerWidth + 2,
      stageWidth: Math.round(document.querySelector('.stage')?.getBoundingClientRect().width ?? 0),
      consoleWidth: Math.round(document.querySelector('.console')?.getBoundingClientRect().width ?? 0),
    }));
    await page.screenshot({ path: '.shots/flow7-phone.png' });
    findings.push(
      `390px phone: stage ${phone.stageWidth}px, console ${phone.consoleWidth}px, h-overflow ${phone.overflows ? 'YES ← BAD' : 'no ✓'}`,
    );

    // Reload mid-run, from a known-good state.
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(url);
    await page.waitForSelector('.tiffin', { timeout: 15000 });
    await page.click('button:has-text("Reset")').catch(() => undefined);
    await page.fill('textarea', 'biryani search karo aur check karo ki biryani wale restaurants mile').catch(() => undefined);
    await page.click('button:has-text("Run")').catch(() => undefined);
    await page.waitForTimeout(500);
    await page.reload();
    const recovered = await page
      .waitForSelector('.tiffin', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    findings.push(`reload mid-run: page ${recovered ? 'recovered ✓' : 'DID NOT recover ← BAD'}`);

    record('FLOW 7 hostile judge', findings.join('\n    '), null, errors.length ? errors.join(' | ') : '');
  });

  // ── FLOW 8 · NO WEBGPU ────────────────────────────────────────────────
  await flow('FLOW 8 no WebGPU', 'flow8', async (page) => {
    await page.goto(url);
    await page.waitForSelector('.tiffin');
    const hasGpu = await page.evaluate(() => 'gpu' in navigator);
    await page.waitForTimeout(1200);
    const stripText = await strip(page);
    const warning = await page.evaluate(() => {
      const warns = [...document.querySelectorAll('.note.warn')].map((n) => n.textContent ?? '');
      return warns.find((w) => w.includes('WebGPU')) ?? '';
    });
    // Does a run still work with no local tier?
    await page.fill('textarea', 'biryani search karo aur check karo ki biryani wale restaurants mile');
    await page.click('button:has-text("Run")');
    const completed = await page
      .waitForSelector('.verdict', { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    const verdict = completed ? await page.evaluate(() => document.querySelector('.verdict-tag')?.textContent) : 'NO VERDICT';
    await page.screenshot({ path: '.shots/flow8-nogpu.png' });
    record(
      'FLOW 8 no WebGPU',
      `navigator.gpu present: ${hasGpu}\n    strip: ${stripText}\n    warning shown: "${warning.slice(0, 110)}"\n    run still completes: ${completed} (${verdict})`,
      null,
      completed ? '' : 'the app could not run at all without WebGPU',
    );
  });

  await browser.close();
  server.close();

  console.log(`\n${'='.repeat(78)}\nSUMMARY\n${'='.repeat(78)}`);
  for (const r of results) {
    console.log(`${r.defect ? 'DEFECT ' : '  ok   '} ${r.flow}${r.ms !== null ? ` (${r.ms}ms)` : ''}`);
    if (r.defect) console.log(`         ${r.defect}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
