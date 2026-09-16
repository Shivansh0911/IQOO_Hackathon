/**
 * Records the five demo clips as real browser footage.
 *
 *   node scripts/record-demo.mjs https://your-site.netlify.app
 *   node scripts/record-demo.mjs                 # serves apps/demo/dist locally
 *
 * Playwright records webm at 1920x1080. Everything here is deliberately SLOW:
 * typing at human speed, pauses long enough to read, and a hold on every
 * verdict. Footage that streams too fast to follow is unusable, and a demo that
 * looks instant looks faked.
 *
 * Clips land in .shots/video/clip-XX-name/*.webm and the script prints the real
 * duration of each, which is what docs/VIDEO_SCRIPT.md is timed against.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, rm, readdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps/demo/dist');
const outDir = path.join(root, '.shots/video');

const argUrl = process.argv[2];
const LOCAL_PORT = 4322;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Human typing. Instant text insertion is the single biggest tell in a fake demo. */
async function typeLikeAPerson(page, selector, text) {
  await page.click(selector);
  await page.fill(selector, '');
  // ~22 chars/sec — fast but visibly human.
  await page.type(selector, text, { delay: 45 });
}

async function serveLocal() {
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
  await new Promise((r) => server.listen(LOCAL_PORT, '127.0.0.1', r));
  return server;
}

/**
 * One clip = one browser context, because Playwright writes the video when the
 * context closes. A persistent profile is NOT used: each clip must start from a
 * genuinely clean state, and `Reset` is pressed first regardless.
 */
async function recordClip(browser, name, body) {
  const dir = path.join(outDir, name);
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
    // Keep the console legible in a 1080p frame.
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

  const started = Date.now();
  let failure = null;
  try {
    await body(page);
  } catch (cause) {
    failure = String(cause).split('\n')[0].slice(0, 150);
  }
  const wall = Date.now() - started;

  await context.close(); // flushes the video file
  const files = (await readdir(dir)).filter((f) => f.endsWith('.webm'));
  let file = null;
  let bytes = 0;
  if (files[0]) {
    const target = path.join(dir, `${name}.webm`);
    await rename(path.join(dir, files[0]), target).catch(() => undefined);
    file = target;
    bytes = (await stat(target).catch(() => ({ size: 0 }))).size;
  }

  return { name, wall, file, bytes, failure, errors };
}

const HINGLISH = 'biryani search karo aur check karo ki biryani wale restaurants mile';
const CART_GOAL = 'add an item from the first biryani restaurant and check the cart total is under 500';
const ORDER_GOAL = 'add an item and place the order';
const FAIL_GOAL = 'check that the first biryani restaurant is rated above 4.9';

/** Shared opening: land, settle, press Reset. Every clip starts clean. */
async function openClean(page, url) {
  await page.goto(url);
  await page.waitForSelector('.tiffin', { timeout: 30000 });
  // Let the tier probe settle so the status strip is truthful on camera.
  await page.waitForTimeout(1800);
  const reset = page.locator('button', { hasText: 'Reset' });
  if (await reset.count()) await reset.first().click();
  await page.waitForTimeout(900);
}

const runButton = (page) => page.locator('button.btn-primary', { hasText: 'Run' });

async function main() {
  const url = argUrl ?? `http://127.0.0.1:${LOCAL_PORT}/`;
  let server = null;
  if (!argUrl) {
    if (!existsSync(dist)) {
      console.error('No URL given and no local build. Run:  npx vite build apps/demo');
      process.exit(1);
    }
    server = await serveLocal();
    console.log(`No URL argument — serving the local production build at ${url}`);
    console.log('For the real video, pass the deployed URL as the first argument.\n');
  } else {
    console.log(`Recording against ${url}\n`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    ignoreDefaultArgs: ['--disable-gpu'],
    args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu', '--hide-scrollbars'],
  });

  const clips = [];

  // ── clip 01 · the goal, end to end ───────────────────────────────────────
  //
  // The run itself finishes in about two seconds, which is far too fast to
  // narrate. So after the verdict this walks back DOWN the completed step log,
  // holding on each step. That is the footage the narration actually needs —
  // "it read the screen, chose node 11, tapped it, verified the total" — and it
  // is honest, because it is the same run, just read at human speed.
  clips.push(
    await recordClip(browser, 'clip-01-goal', async (page) => {
      await openClean(page, url);
      await typeLikeAPerson(page, 'textarea', HINGLISH);
      await page.waitForTimeout(1600); // let the viewer read the goal
      await runButton(page).click();
      await page.waitForSelector('.verdict', { timeout: 120000 });
      await page.waitForTimeout(2600); // HOLD on the verdict

      // Walk the steps, one at a time, with the amber index badge visible in
      // the JSON line of each row.
      const rows = await page.locator('.row').count();
      for (let i = 0; i < Math.min(rows, 6); i += 1) {
        await page
          .locator('.row')
          .nth(i)
          .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await page.waitForTimeout(2300);
      }
      await page.waitForTimeout(2000);
    }),
  );

  // ── clip 02 · the token count and the node list ──────────────────────────
  //
  // The console's own log carries the evidence: run the cart goal, then expand
  // a step to show the exact JSON the model was given, with the token count.
  clips.push(
    await recordClip(browser, 'clip-02-tokens', async (page) => {
      await openClean(page, url);
      await typeLikeAPerson(page, 'textarea', CART_GOAL);
      await page.waitForTimeout(600);
      await runButton(page).click();
      await page.waitForSelector('.verdict', { timeout: 120000 });
      await page.waitForTimeout(1200);

      // Hold on the status strip, which carries the live token count.
      await page.evaluate(() => document.querySelector('.status')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(2500);

      // Then the step log, scrolled slowly so the reasons and JSON are legible.
      const log = page.locator('.log');
      for (const y of [0, 120, 240, 360, 480]) {
        await log.evaluate((el, top) => el.scrollTo({ top, behavior: 'smooth' }), y);
        await page.waitForTimeout(1100);
      }
      await page.waitForTimeout(1500);
    }),
  );

  // ── clip 03 · the destructive gate ───────────────────────────────────────
  clips.push(
    await recordClip(browser, 'clip-03-guardrail', async (page) => {
      await openClean(page, url);
      await typeLikeAPerson(page, 'textarea', ORDER_GOAL);
      await page.waitForTimeout(600);
      await runButton(page).click();
      await page.waitForSelector('.sheet', { timeout: 120000 });
      await page.waitForTimeout(2600); // HOLD so the sheet is readable
      await page.locator('button', { hasText: 'Deny' }).click();
      await page.waitForSelector('.verdict', { timeout: 30000 });
      await page.waitForTimeout(2200); // HOLD on Blocked
    }),
  );

  // ── clip 04 · the deliberate failure, and the report ─────────────────────
  clips.push(
    await recordClip(browser, 'clip-04-fail', async (page) => {
      await openClean(page, url);
      await typeLikeAPerson(page, 'textarea', FAIL_GOAL);
      await page.waitForTimeout(600);
      await runButton(page).click();
      await page.waitForSelector('.verdict', { timeout: 120000 });
      await page.waitForTimeout(2600); // HOLD on the red verdict

      // Scroll to the failing assert line and hold on it.
      await page.evaluate(() => {
        const fail = [...document.querySelectorAll('.row-json')].find((e) => e.textContent?.includes('FAIL'));
        fail?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      await page.waitForTimeout(2600);
    }),
  );

  // ── clip 05 · the Guardrails panel. THE MOST IMPORTANT CLIP. ─────────────
  //
  // Given the most time deliberately: every other team will show a happy path,
  // and this is the one thing they cannot show.
  clips.push(
    await recordClip(browser, 'clip-05-rejects', async (page) => {
      await openClean(page, url);

      const show = page.locator('button', { hasText: 'Show the evidence' });
      await show.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1400); // read the "15 of 20 were rejected" line
      await show.click();
      await page.waitForTimeout(2600); // read the first rejection in full

      // Step through several real rejections, holding on each.
      const next = page.locator('button', { hasText: 'next' });
      for (let i = 0; i < 5; i += 1) {
        if (!(await next.isEnabled().catch(() => false))) break;
        await next.click();
        await page.evaluate(() => {
          const inset = document.querySelector('.row-inset');
          inset?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        await page.waitForTimeout(2800); // long enough to READ the raw output
      }
      await page.waitForTimeout(1800);
    }),
  );

  await browser.close();
  if (server) server.close();

  // ── Report ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(74));
  console.log('CLIPS');
  console.log('='.repeat(74));
  let total = 0;
  for (const c of clips) {
    total += c.wall;
    const secs = (c.wall / 1000).toFixed(1);
    const mb = (c.bytes / 1e6).toFixed(1);
    console.log(
      `${c.failure ? 'FAILED ' : '  ok   '} ${c.name.padEnd(20)} ${secs.padStart(6)}s  ${mb.padStart(5)}MB  ${c.file ? path.relative(root, c.file) : 'NO FILE'}`,
    );
    if (c.failure) console.log(`         ${c.failure}`);
    if (c.errors.length) console.log(`         page errors: ${c.errors.join(' | ')}`);
  }
  console.log('='.repeat(74));
  console.log(`total footage ${(total / 1000).toFixed(1)}s across ${clips.length} clips`);
  console.log(`\nClips are in ${path.relative(root, outDir)}/`);
  console.log('Time docs/VIDEO_SCRIPT.md against the durations above, not against guesses.\n');

  if (clips.some((c) => c.failure)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
