/**
 * Exercises EVERY user-facing feature on the deployed site.
 *
 *   node scripts/check-live.mjs                              # the live URL
 *   node scripts/check-live.mjs https://other.netlify.app
 *
 * verify-flows.mjs tests the local production build. This tests the thing at
 * the end of the link, which is the only artefact a judge ever touches — and
 * "the config is right" and "the deploy works" are different claims, only one
 * of which a config file can answer.
 *
 * Every check reports what it actually observed, so a pass is readable evidence
 * rather than a green tick. The one thing it will not do is download the 1.1GB
 * model: it asserts that the local tier reports its state HONESTLY instead,
 * because an automated 1.1GB fetch on every run is not a check, it is a bill.
 */

import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const URL = process.argv[2] ?? 'https://origoloop.netlify.app';
const root = path.resolve(import.meta.dirname, '..');
const shots = path.join(root, '.shots/live');

const results = [];
const record = (name, detail, ok) => {
  results.push({ name, detail, ok });
  console.log(`  ${ok ? 'ok     ' : 'BROKEN '} ${name.padEnd(34)} ${detail}`);
};

const stripText = (page) =>
  page.evaluate(() => document.querySelector('.status')?.innerText.replace(/\s+/g, ' ').trim() ?? 'NO STRIP');

const warnings = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.note.warn')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
  );

/** Presses Reset and waits for the console to be idle again. */
async function reset(page) {
  const button = page.locator('button', { hasText: 'Reset' });
  if (await button.count()) await button.first().click();
  await page.waitForTimeout(400);
}

/** Runs the current goal to a verdict, denying a confirmation sheet if one appears. */
async function runToVerdict(page, { deny = true } = {}) {
  await page.locator('button.btn-primary', { hasText: 'Run' }).click();
  const sheet = page.locator('.sheet');
  const verdict = page.locator('.verdict');
  await Promise.race([
    sheet.waitFor({ timeout: 90000 }).catch(() => undefined),
    verdict.waitFor({ timeout: 90000 }).catch(() => undefined),
  ]);
  let sawSheet = false;
  if (await sheet.count()) {
    sawSheet = true;
    if (deny) {
      await page.locator('button', { hasText: 'Deny' }).click();
      await verdict.waitFor({ timeout: 30000 });
    }
  }
  const state = await page.evaluate(() => ({
    tag: document.querySelector('.verdict-tag')?.textContent?.trim() ?? '?',
    klass: document.querySelector('.verdict')?.className ?? '',
    reason: document.querySelector('.verdict-reason')?.textContent?.trim() ?? '',
    steps: document.querySelectorAll('.row').length,
  }));
  return { ...state, sawSheet };
}

async function main() {
  await mkdir(shots, { recursive: true });
  console.log(`\nDriving ${URL}\n${'='.repeat(78)}\n`);

  const browser = await chromium.launch({
    ignoreDefaultArgs: ['--disable-gpu'],
    args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 140)));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url().slice(0, 70)} ${r.failure()?.errorText}`));

  // ── 1 · It loads, and both panes are there ────────────────────────────────
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.tiffin', { timeout: 30000 });
  const loadMs = Date.now() - t0;
  const panes = await page.evaluate(() => ({
    app: Boolean(document.querySelector('.tiffin')),
    console: Boolean(document.querySelector('.console')),
    restaurants: document.querySelectorAll('.t-card, [class*="card"]').length,
  }));
  record(
    'page loads, both panes',
    `${loadMs}ms · target app ${panes.app ? 'yes' : 'NO'} · console ${panes.console ? 'yes' : 'NO'}`,
    panes.app && panes.console,
  );

  await page.waitForTimeout(2200); // let the tier probe settle
  const strip = await stripText(page);
  record(
    'status strip is truthful',
    strip,
    strip.includes('PLATFORM web') && strip.includes('PLANNER') && !strip.includes('PLANNER none'),
  );

  // ── 2 · The guidance a judge needs, before touching anything ──────────────
  const guidance = await page.evaluate(() => {
    const el = document.querySelector('.onboard');
    return {
      present: Boolean(el),
      steps: el ? el.querySelectorAll('li').length : 0,
      text: el ? el.innerText.replace(/\s+/g, ' ').slice(0, 80) : '',
    };
  });
  record(
    'start-here guidance on screen',
    guidance.present ? `${guidance.steps} numbered steps: "${guidance.text}…"` : 'ABSENT — a judge gets no instructions',
    guidance.present && guidance.steps >= 3,
  );

  const presets = await page.locator('button.example').count();
  record('preset goal buttons', `${presets} one-click goals`, presets >= 4);

  // ── 3 · Every preset goal reaches its documented verdict ──────────────────
  const GOALS = [
    { button: 'Hinglish · search and verify', expect: 'pass', name: 'run · Hinglish goal' },
    { button: 'Cart total under ₹500', expect: 'pass', name: 'run · cart total' },
    { button: 'Guardrail · try to order', expect: 'blocked', name: 'run · destructive gate' },
    { button: 'Fails on purpose', expect: 'fail', name: 'run · deliberate failure' },
  ];
  for (const goal of GOALS) {
    await reset(page);
    const button = page.locator('button.example', { hasText: goal.button });
    if (!(await button.count())) {
      record(goal.name, `preset button "${goal.button}" NOT FOUND`, false);
      continue;
    }
    await button.first().click();
    await page.waitForTimeout(250);
    const got = await runToVerdict(page);
    const ok = got.tag.toLowerCase().includes(goal.expect);
    const extra =
      goal.expect === 'blocked'
        ? ` · confirmation sheet ${got.sawSheet ? 'shown then denied' : 'NEVER APPEARED'}`
        : goal.expect === 'fail'
          ? ` · styled red ${got.klass.includes('fail') ? 'yes' : 'NO'}`
          : '';
    record(goal.name, `${got.tag} · ${got.steps} steps${extra} · ${got.reason.slice(0, 60)}`, ok && (goal.expect !== 'blocked' || got.sawSheet));
  }

  // ── 4 · Tokens appear once a screen has been read ─────────────────────────
  const tokens = await stripText(page);
  record(
    'live token count',
    tokens.match(/TOKENS ([^ ]+)/)?.[0] ?? 'not shown',
    /TOKENS \d+/.test(tokens),
  );

  // ── 5 · A free-form goal warns BEFORE the run, not after ──────────────────
  await reset(page);
  await page.fill('textarea', 'search for pizza and check that the price is under 300');
  await page.waitForTimeout(400);
  const warned = (await warnings(page)).some((w) => w.includes('not one of the example goals'));
  record(
    'free-form goal warns first',
    warned ? 'warning shown before Run, naming both ways to fix it' : 'NO WARNING — Blocked will look like breakage',
    warned,
  );

  // ── 6 · The report, downloaded and opened offline ─────────────────────────
  await reset(page);
  await page.locator('button.example', { hasText: 'Cart total under ₹500' }).first().click();
  await page.waitForTimeout(250);
  await runToVerdict(page);

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 25000 }),
    page.locator('button', { hasText: 'Download HTML' }).click(),
  ]).then(([d]) => d);
  const saved = path.join(shots, 'live-report.html');
  await download.saveAs(saved);
  const html = await readFile(saved, 'utf8');
  const external = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((u) => /^(https?:)?\/\//.test(u));

  const viewer = await context.newPage();
  await viewer.route('**', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await viewer.goto('file:///' + saved.split(path.sep).join('/'));
  const rendered = await viewer.evaluate(() => document.body.innerText.trim().length);
  await viewer.close();
  record(
    'report downloads + opens offline',
    `${(html.length / 1024).toFixed(0)}kB · ${external.length} external refs · ${rendered} chars rendered with the network cut`,
    external.length === 0 && rendered > 400,
  );

  const copy = page.locator('button', { hasText: 'Copy as text' });
  record('report · copy as text', (await copy.count()) ? 'button present' : 'MISSING', (await copy.count()) > 0);

  // ── 7 · The Guardrails panel replays real rejections ──────────────────────
  const show = page.locator('button', { hasText: /Show the evidence|Hide the evidence/ });
  let guardrails = { ok: false, detail: 'panel not found' };
  if (await show.count()) {
    const label = await show.first().innerText();
    if (label.includes('Show')) await show.first().click();
    await page.waitForTimeout(600);
    const inset = await page.evaluate(() => {
      const el = document.querySelector('.row-inset');
      return { present: Boolean(el), text: el ? el.innerText.replace(/\s+/g, ' ').slice(0, 110) : '' };
    });
    const next = page.locator('button', { hasText: 'next' });
    let stepped = false;
    if ((await next.count()) && (await next.first().isEnabled())) {
      await next.first().click();
      await page.waitForTimeout(500);
      stepped = true;
    }
    guardrails = {
      ok: inset.present && stepped,
      detail: `${inset.present ? 'rejection shown' : 'NO REJECTION'} · ${stepped ? 'next works' : 'next DISABLED'} · "${inset.text}…"`,
    };
  }
  record('guardrails panel', guardrails.detail, guardrails.ok);

  // ── 7b · Can a HUMAN actually reach the lower panels? ─────────────────────
  //
  // This check exists because its absence hid a real defect. The console had
  // overflow:hidden with a flex:1 step log, so the voice panel, the report
  // buttons, the guardrails evidence and the settings all sat below the fold
  // with no scrollbar — unreachable with a mouse. Every earlier check passed
  // anyway, because scrollIntoViewIfNeeded() scrolls a container
  // programmatically even when overflow is hidden. Presence is not reach.
  const reach = await page.evaluate(() => {
    const scrollableAncestor = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2) return true;
        // A clipped ancestor that cannot scroll is exactly the trap.
        if (style.overflowY === 'hidden' && node.scrollHeight > node.clientHeight + 2) return false;
      }
      return true;
    };

    const named = (pattern) =>
      [...document.querySelectorAll('button')].find((b) => pattern.test(b.textContent ?? '')) ?? null;

    const targets = {
      voice: named(/Hold to speak/i),
      report: named(/Download HTML/i),
      guardrails: named(/Show the evidence|Hide the evidence/i),
      settings: document.querySelector('select'),
    };

    const out = {};
    for (const [label, el] of Object.entries(targets)) {
      out[label] = !el ? 'MISSING' : scrollableAncestor(el) ? 'reachable' : 'TRAPPED behind a clipped container';
    }
    return out;
  });
  const trapped = Object.entries(reach).filter(([, v]) => v !== 'reachable');
  record(
    'lower panels reachable by scrolling',
    trapped.length
      ? trapped.map(([k, v]) => `${k}: ${v}`).join(' · ')
      : `all reachable — ${Object.keys(reach).join(', ')}`,
    trapped.length === 0,
  );

  // ── 8 · Voice is present and honest about itself ──────────────────────────
  const voice = await page.evaluate(() => {
    const hold = [...document.querySelectorAll('button')].find((b) => /hold to speak/i.test(b.textContent ?? ''));
    return {
      button: Boolean(hold),
      supported: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window,
      languages: document.querySelectorAll('select option').length,
    };
  });
  record(
    'voice input',
    `control ${voice.button ? 'present' : 'MISSING'} · Web Speech ${voice.supported ? 'available' : 'unavailable (panel must say so)'}`,
    voice.button,
  );

  // ── 9 · On-device tier: honest, and never a silent 1.1GB ──────────────────
  const onDevice = await page.evaluate(() => {
    const text = document.body.innerText;
    const loadButton = [...document.querySelectorAll('button')].some((b) => /Load model|Demo mode/i.test(b.textContent ?? ''));
    return {
      loadButton,
      gpuUsable: Boolean(navigator.gpu) && !/no adapter was granted|has no WebGPU/i.test(text),
      mentionsSize: /1\.1\s?GB/i.test(text),
      statesState: /not loaded yet|unavailable|available/i.test(text),
    };
  });
  // The download size is only stated when the model could actually be fetched.
  // On a machine with no usable GPU adapter the panel says THAT instead, which
  // is the more useful truth — so requiring the size unconditionally was a bug
  // in this check, not in the page. It failed here for exactly that reason.
  const sizeExpected = onDevice.gpuUsable;
  record(
    'on-device tier is opt-in',
    `button ${onDevice.loadButton ? 'yes' : 'NO'} · state stated ${onDevice.statesState ? 'yes' : 'NO'} · ` +
      (sizeExpected
        ? `download size stated ${onDevice.mentionsSize ? 'yes' : 'NO'}`
        : 'no usable GPU here, so the panel states that rather than a size'),
    onDevice.loadButton && onDevice.statesState && (!sizeExpected || onDevice.mentionsSize),
  );

  // ── 10 · STOP interrupts a run ────────────────────────────────────────────
  await reset(page);
  await page.locator('button.example', { hasText: 'Hinglish · search and verify' }).first().click();
  await page.waitForTimeout(200);
  await page.locator('button.btn-primary', { hasText: 'Run' }).click();
  const stop = page.locator('button.btn-stop');
  let stopped = 'STOP button never appeared';
  let stopOk = false;
  if (await stop.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
    await stop.click();
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      running: Boolean(document.querySelector('.btn-stop')),
      verdict: document.querySelector('.verdict-tag')?.textContent?.trim() ?? 'none',
    }));
    stopOk = !after.running;
    stopped = `pressed · run ${after.running ? 'STILL RUNNING' : 'ended'} · verdict ${after.verdict}`;
  }
  record('STOP interrupts a run', stopped, stopOk);

  // ── 11 · Phone layout ─────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const phone = await page.evaluate(() => ({
    app: (document.querySelector('.tiffin')?.getBoundingClientRect().width ?? 0) > 100,
    console: (document.querySelector('.console')?.getBoundingClientRect().width ?? 0) > 100,
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
  }));
  await page.screenshot({ path: path.join(shots, 'live-phone.png') });
  record(
    'phone layout (390px)',
    `app ${phone.app ? 'visible' : 'COLLAPSED'} · console ${phone.console ? 'visible' : 'COLLAPSED'} · h-scroll ${phone.hScroll ? 'YES (bad)' : 'no'}`,
    phone.app && phone.console && !phone.hScroll,
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Verdict ───────────────────────────────────────────────────────────────
  await page.screenshot({ path: path.join(shots, 'live-desktop.png'), fullPage: false });
  await browser.close();

  console.log(`\n  page errors     : ${pageErrors.length ? pageErrors.join(' | ') : 'none'}`);
  console.log(`  failed requests : ${failedRequests.length ? failedRequests.join(' | ') : 'none'}`);

  const broken = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(78));
  console.log(`${results.length - broken.length} of ${results.length} features working on the deployed site`);
  if (pageErrors.length) broken.push({ name: 'page errors' });
  if (broken.length) {
    console.log('\nNOT WORKING:');
    for (const b of broken) console.log(`  · ${b.name}`);
    process.exit(1);
  }
  console.log('Every feature a judge can reach works on the live URL.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
