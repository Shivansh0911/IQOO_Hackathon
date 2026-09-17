/**
 * Records clip-06-ondevice.webm: the strip flipping to the local tier, staying
 * there with the network off, and the on-device model producing a real action.
 *
 *   node scripts/record-ondevice.mjs                                  # live URL
 *   node scripts/record-ondevice.mjs https://origoloop.netlify.app
 *   node scripts/record-ondevice.mjs --warm-only                      # cache only
 *
 * This is the one claim in the pitch with no footage behind it. Every other
 * clip reads `PLANNER mock · MODEL scripted`, which is honest but means a
 * reviewer has no visual evidence the on-device tier exists at all.
 *
 * TWO PHASES, and the split is the whole point. Phase one loads the model with
 * no camera running, so the 1.1GB download happens off screen and into a
 * PERSISTENT profile. Phase two reopens that same profile — where the weights
 * are already in CacheStorage, keyed to this origin — and records a warm load
 * that takes seconds. Filming a progress bar for two minutes would be both
 * boring and a misrepresentation of what a returning user experiences.
 */

import { chromium } from 'playwright';
import { mkdir, rm, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const URL = args.find((a) => a.startsWith('http')) ?? 'https://origoloop.netlify.app';
const WARM_ONLY = args.includes('--warm-only');

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.shots/video/clip-06-ondevice');
// The weights live here between the two phases. Per origin, so this profile is
// only warm for the URL it was warmed against.
const profileDir = path.join(root, '.shots/live-model-profile');

const GOAL = 'tap the first restaurant';

const LAUNCH = {
  headless: false,
  viewport: { width: 1920, height: 1080 },
  ignoreDefaultArgs: ['--disable-gpu'],
  args: [
    '--enable-unsafe-webgpu',
    // Chrome hands WebGPU the integrated GPU by default on a two-GPU laptop,
    // which measured 41s per call against 2.3s on the discrete one.
    '--force_high_performance_gpu',
    '--hide-scrollbars',
  ],
};

const strip = (page) =>
  page.evaluate(() => document.querySelector('.status')?.innerText.replace(/\s+/g, ' ').trim() ?? 'NO STRIP');

/** Dismisses the start-here panel so it does not sit over the console on camera. */
async function dismissGuide(page) {
  const hide = page.locator('button.onboard-hide');
  if (await hide.count()) {
    await hide.first().click();
    await page.waitForTimeout(250);
  }
}

/** Phase one: get the weights into the profile, with nothing recording. */
async function warm() {
  console.log(`\nPHASE 1 · warming the model cache for ${URL}`);
  console.log('  This downloads ~1.1GB once. Nothing is being recorded.\n');
  await mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, LAUNCH);
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.tiffin', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await dismissGuide(page);

  const before = await strip(page);
  console.log(`  strip before: ${before}`);

  const load = page.locator('button', { hasText: /^(Load model|\d+%|Model ready)$/ });
  if (!(await load.count())) {
    console.error('  No "Load model" button found. Is this the right build?');
    await context.close();
    process.exit(1);
  }
  const label = await load.first().innerText();
  if (label !== 'Model ready') await load.first().click();

  const started = Date.now();
  let lastReport = 0;
  // Poll the strip rather than a progress bar: the strip is the thing that has
  // to end up saying `local`, so it is also the honest completion signal.
  for (;;) {
    const now = await strip(page);
    if (/PLANNER local/.test(now)) {
      console.log(`\n  READY in ${((Date.now() - started) / 1000).toFixed(0)}s — ${now}`);
      break;
    }
    if (Date.now() - started > 15 * 60 * 1000) {
      console.error(`\n  Timed out after 15 minutes. Last strip: ${now}`);
      await context.close();
      process.exit(1);
    }
    if (Date.now() - lastReport > 15000) {
      lastReport = Date.now();
      const note = await page
        .evaluate(() => {
          const el = [...document.querySelectorAll('.note')].find((n) => /fetch|load|cache|%|MB/i.test(n.textContent ?? ''));
          return el?.textContent?.trim().slice(0, 90) ?? '';
        })
        .catch(() => '');
      console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s  ${note || 'loading…'}`);
    }
    await page.waitForTimeout(1500);
  }

  await page.waitForTimeout(1500);
  await context.close();
  console.log('  Profile is warm. The weights are cached for this origin.\n');
}

/** Phase two: the take. */
async function record() {
  console.log('PHASE 2 · recording clip-06-ondevice\n');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    ...LAUNCH,
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const beats = [];
  const mark = (what, detail) => {
    beats.push({ at: ((Date.now() - t0) / 1000).toFixed(1), what, detail });
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${what.padEnd(26)} ${detail}`);
  };

  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.tiffin', { timeout: 60000 });
  await page.waitForTimeout(2000);
  await dismissGuide(page);
  // Scroll the console so the Settings row and the strip are both in frame.
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => /On-device/i.test(l.textContent ?? ''));
    label?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(800);

  const t0 = Date.now();

  // ── beat 1 · the strip as a first-time visitor sees it ──────────────────
  mark('strip on arrival', await strip(page));
  await page.waitForTimeout(2200);

  // ── beat 2 · press load, and let it flip ────────────────────────────────
  const load = page.locator('button', { hasText: /^(Load model|\d+%|Model ready)$/ });
  const label = await load.first().innerText();
  if (label !== 'Model ready') {
    await load.first().click();
    mark('pressed Load model', 'warm — should take seconds');
  } else {
    mark('model already ready', 'no press needed');
  }

  const flipStart = Date.now();
  for (;;) {
    if (/PLANNER local/.test(await strip(page))) break;
    if (Date.now() - flipStart > 90000) {
      console.error('\n  The strip never flipped to local in 90s — cut the take.');
      await context.close();
      process.exit(1);
    }
    await page.waitForTimeout(400);
  }
  const flipSeconds = (Date.now() - flipStart) / 1000;
  mark('strip flipped to local', `${flipSeconds.toFixed(1)}s on camera`);
  if (flipSeconds > 2.5) {
    console.log(`\n  WARNING: ${flipSeconds.toFixed(1)}s of spinner is on camera.`);
    console.log('  The brief allows no more than 2s. Re-run to record a warmer take.\n');
  }

  // ── beat 3 · hold four full seconds on the local strip ──────────────────
  await page.waitForTimeout(4000);
  mark('held on local strip', await strip(page));

  // ── beat 4 · network off, and it stays local ────────────────────────────
  await context.setOffline(true);
  await page.waitForTimeout(3200);
  const offlineStrip = await strip(page);
  mark('network off, still local', offlineStrip);
  const offlineOk = /NETWORK off/.test(offlineStrip) && /PLANNER local/.test(offlineStrip);
  if (!offlineOk) {
    console.error('\n  The strip does not read `local` with `NETWORK off` — that is the claim. Cut.');
    await context.close();
    process.exit(1);
  }

  // ── beat 5 · one real action, planned on-device, with no network ────────
  await page.evaluate(() => document.querySelector('textarea')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await page.click('textarea');
  await page.fill('textarea', '');
  await page.type('textarea', GOAL, { delay: 45 });
  await page.waitForTimeout(600);
  await page.locator('button.btn-primary', { hasText: 'Run' }).click();
  mark('running on the local tier', `goal: "${GOAL}"`);

  // Wait for the first executed step to appear, then hold on it. One action is
  // the whole requirement: multi-step completion is the open problem and the
  // caption says so.
  const appeared = await page
    .waitForFunction(() => document.querySelectorAll('.row').length >= 1, { timeout: 120000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.row')].slice(0, 2).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 90)),
    );
    mark('first action executed', rows[0] ?? '(row unreadable)');
    await page.waitForTimeout(3000);
  } else {
    mark('no action in 120s', 'the take is still usable but weaker');
  }

  // Stop the run rather than filming a stall: the multi-step gap is real and
  // the caption states it, but footage of a loop is not evidence of anything.
  const stop = page.locator('button.btn-stop');
  if (await stop.count()) {
    await stop.first().click();
    await page.waitForTimeout(1800);
    mark('stopped', await strip(page));
  }

  await context.setOffline(false);
  await context.close(); // flushes the video

  const files = (await readdir(outDir)).filter((f) => f.endsWith('.webm'));
  if (!files[0]) {
    console.error('\nNo video file was written.');
    process.exit(1);
  }
  // The sidecar the renderer reads to cut this take down. Written from the
  // offsets measured above, so a re-recorded clip carries its own window and
  // never inherits a stale one from a previous take.
  const beatAt = (what) => Number(beats.find((b) => b.what === what)?.at ?? 0);
  const flipped = beatAt('strip flipped to local');
  const stopped = beatAt('stopped') || (Date.now() - t0) / 1000;
  await writeFile(
    path.join(outDir, 'beats.json'),
    JSON.stringify(
      {
        note: 'Beat offsets in seconds into this clip, measured during the take. `window` is what the renderer cuts to.',
        recordedAgainst: URL,
        source: Number(((Date.now() - t0) / 1000).toFixed(1)),
        beats: Object.fromEntries(beats.map((b) => [b.what, Number(b.at)])),
        // Start 2.2s before the flip: the press and a moment of progress stay
        // on camera, the rest of the load is cut. End just after the executed
        // action so the viewer can read it.
        window: [Number(Math.max(0, flipped - 2.2).toFixed(1)), Number(Math.min(stopped - 3.5, flipped + 22.8).toFixed(1))],
      },
      null,
      2,
    ),
    'utf8',
  );

  const target = path.join(outDir, 'clip-06-ondevice.webm');
  await rename(path.join(outDir, files[0]), target);
  const bytes = (await stat(target)).size;
  const seconds = (Date.now() - t0) / 1000;

  console.log(`\n  ${path.relative(root, target)}  ${(bytes / 1e6).toFixed(1)}MB  ~${seconds.toFixed(1)}s`);
  if (seconds < 11 || seconds > 26) {
    console.log(`  NOTE: ${seconds.toFixed(1)}s is outside the 12-18s target; the renderer trims and holds to fit.`);
  }
  console.log('\nNow re-render:');
  console.log(`  node scripts/render-video.mjs --url ${URL}\n`);
}

async function main() {
  const alreadyWarm = existsSync(profileDir);
  console.log(`Target: ${URL}`);
  console.log(`Profile: ${path.relative(root, profileDir)}${alreadyWarm ? ' (exists)' : ' (new)'}`);
  await warm();
  if (WARM_ONLY) {
    console.log('--warm-only: stopping before the take.');
    return;
  }
  await record();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
