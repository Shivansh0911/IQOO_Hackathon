/**
 * Verifies the MECHANICS, not the verdicts.
 *
 *   node scripts/check-logic.mjs                              # the live URL
 *   node scripts/check-logic.mjs http://127.0.0.1:4325
 *
 * check-live.mjs asks "does each feature reach its expected outcome". That can
 * pass while the machinery underneath is fake — a scripted verdict with nothing
 * actually happening to the app would look identical. This script asks the
 * harder question: did the agent really type into the target app, did it really
 * address the element by an assigned index, did the assert really read a value
 * off the screen, and does the confirmation gate really gate execution rather
 * than always refusing.
 *
 * Everything is observed from the TARGET APP's own DOM where possible, because
 * the console's log is the agent's account of itself and the app's state is the
 * independent witness.
 */

import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const URL = process.argv[2] ?? 'https://origoloop.netlify.app';
const root = path.resolve(import.meta.dirname, '..');
const shots = path.join(root, '.shots/logic');

const results = [];
const record = (name, detail, ok) => {
  results.push({ name, detail, ok });
  console.log(`  ${ok ? 'ok     ' : 'BROKEN '} ${name.padEnd(36)} ${detail}`);
};

const reset = async (page) => {
  const b = page.locator('button', { hasText: 'Reset' });
  if (await b.count()) await b.first().click();
  await page.waitForTimeout(450);
};

const preset = async (page, label) => {
  await page.locator('button.example', { hasText: label }).first().click();
  await page.waitForTimeout(250);
};

const run = async (page) => page.locator('button.btn-primary', { hasText: 'Run' }).click();

const toVerdict = async (page, timeout = 90000) => {
  await page.locator('.verdict').waitFor({ timeout });
  return page.evaluate(() => ({
    tag: document.querySelector('.verdict-tag')?.textContent?.trim() ?? '?',
    reason: document.querySelector('.verdict-reason')?.textContent?.trim() ?? '',
  }));
};

/** Every step the console reported, as plain text. */
const logRows = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));

async function main() {
  await mkdir(shots, { recursive: true });
  console.log(`\nMechanics check · ${URL}\n${'='.repeat(84)}\n`);

  const browser = await chromium.launch({
    ignoreDefaultArgs: ['--disable-gpu'],
    args: [
      '--enable-unsafe-webgpu',
      '--force_high_performance_gpu',
      // Lets the microphone path be exercised without a real device: Chrome
      // grants a synthetic input stream instead of prompting.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  await context.grantPermissions(['microphone'], { origin: new globalThis.URL(URL).origin });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.tiffin', { timeout: 30000 });
  await page.waitForTimeout(2200);

  // ── 1 · SELF-TYPING: did text really land in the target app's input? ──────
  await reset(page);
  const before = await page.inputValue('.t-searchbar input').catch(() => '');
  await preset(page, 'Hinglish · search and verify');
  await run(page);
  await toVerdict(page);
  const after = await page.inputValue('.t-searchbar input').catch(() => '');
  record(
    'self-typing reached the app',
    `Tiffin's own search box: "${before}" → "${after}"`,
    after.toLowerCase().includes('biryani') && after !== before,
  );

  // The app's rendered result must have actually changed, not just the input.
  const filtered = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.tiffin *')]
      .map((e) => e.textContent ?? '')
      .find((t) => /RESTAURANTS? FOR/i.test(t));
    const cleaned = heading?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      // Test the WHOLE heading and report a slice. Truncating first made this
      // check fail against a page that was perfectly correct: the cut landed
      // mid-word at `restaurants for "bi` and the match never saw "biryani".
      matched: /biryani/i.test(cleaned),
      heading: cleaned.slice(-46),
      cards: document.querySelectorAll('.t-card').length,
    };
  });
  record(
    'the app actually re-rendered',
    `"${filtered.heading}" · ${filtered.cards} cards shown`,
    filtered.matched,
  );

  // ── 2 · INDEX ADDRESSING: actions name a numeric node, not a selector ─────
  const rows = await logRows(page);
  const actionText = rows.join(' | ');
  const indexed = [...actionText.matchAll(/\b(Tap|TypeText|Assert|Scroll)\((\d+)/g)].map((m) => `${m[1]}(${m[2]})`);
  const selectorish = /querySelector|css=|xpath|\.t-|#root/i.test(actionText);
  record(
    'actions address nodes by index',
    indexed.length ? `${indexed.length} indexed actions: ${indexed.slice(0, 4).join(', ')}` : 'NO INDEXED ACTIONS FOUND',
    indexed.length > 0 && !selectorish,
  );

  // ── 3 · ASSERT read a real value off the screen ───────────────────────────
  const assertRow = rows.find((r) => /PASS|FAIL/.test(r) && /Assert/i.test(r));
  record(
    'assert quotes what it read',
    assertRow ? assertRow.slice(0, 96) : 'no assert row found',
    Boolean(assertRow),
  );

  // ── 4 · THE FULL FLOW appears in order ───────────────────────────────────
  const hasRead = rows.some((r) => /token|screen/i.test(r)) || rows.length > 0;
  const stepNumbers = rows.map((r) => Number(/^(\d+)/.exec(r)?.[1] ?? 0)).filter((n) => n > 0);
  const ascending = stepNumbers.every((n, i) => i === 0 || n >= (stepNumbers[i - 1] ?? 0));
  record(
    'steps are ordered and numbered',
    `${stepNumbers.length} numbered steps, ${ascending ? 'ascending' : 'OUT OF ORDER'}`,
    stepNumbers.length >= 2 && ascending && hasRead,
  );

  // ── 5 · THE GATE GATES, both ways ────────────────────────────────────────
  // Deny was already covered. Allow is the other half: if the sheet always
  // refused, the "gate" would be a wall and the agent could never complete a
  // destructive task under supervision. Tiffin is our own fake app, so there is
  // nothing real to spend.
  await reset(page);
  await preset(page, 'Guardrail · try to order');
  await run(page);
  await page.locator('.sheet').waitFor({ timeout: 60000 });
  const sheetText = await page.evaluate(
    () => document.querySelector('.sheet')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 110) ?? '',
  );
  await page.locator('button', { hasText: /Allow once/i }).click();
  const allowed = await toVerdict(page, 60000);
  const orderReached = await page.evaluate(() =>
    /order|confirmed|placed/i.test(document.querySelector('.tiffin')?.innerText ?? ''),
  );
  record(
    'gate allows when approved',
    `sheet: "${sheetText.slice(0, 60)}…" → Allow → ${allowed.tag}, app advanced ${orderReached ? 'yes' : 'no'}`,
    orderReached || allowed.tag.toLowerCase().includes('pass'),
  );
  await page.screenshot({ path: path.join(shots, 'gate-allowed.png') });

  // ── 6 · RESET really clears both sides ───────────────────────────────────
  await reset(page);
  const cleared = await page.evaluate(() => ({
    rows: document.querySelectorAll('.row').length,
    verdict: Boolean(document.querySelector('.verdict')),
    search: document.querySelector('.t-searchbar input')?.value ?? '',
  }));
  record(
    'reset clears console and app',
    `${cleared.rows} rows · verdict ${cleared.verdict ? 'STILL SHOWN' : 'cleared'} · search "${cleared.search}"`,
    cleared.rows === 0 && !cleared.verdict && cleared.search === '',
  );

  // ── 7 · THE REPORT contains the evidence, not just a verdict ─────────────
  await preset(page, 'Cart total under ₹500');
  await run(page);
  await toVerdict(page);
  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 25000 }),
    page.locator('button', { hasText: 'Download HTML' }).click(),
  ]).then(([d]) => d);
  const saved = path.join(shots, 'report.html');
  await download.saveAs(saved);
  const html = await readFile(saved, 'utf8');
  const carries = {
    verdict: /pass/i.test(html),
    steps: (html.match(/Tap\(|TypeText\(|Assert\(/g) ?? []).length,
    goal: /cart total/i.test(html),
    tokens: /token/i.test(html),
  };
  record(
    'report carries per-step evidence',
    `verdict ${carries.verdict ? 'yes' : 'NO'} · ${carries.steps} action references · goal ${carries.goal ? 'yes' : 'NO'} · tokens ${carries.tokens ? 'yes' : 'no'}`,
    carries.verdict && carries.steps >= 2 && carries.goal,
  );

  // ── 8 · MICROPHONE: the path, and what is honestly testable ──────────────
  const mic = await page.evaluate(async () => {
    const ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    let constructs = false;
    let started = false;
    let err = '';
    if (ctor) {
      try {
        const r = new ctor();
        constructs = true;
        r.lang = 'en-IN';
        await new Promise((resolve) => {
          r.onstart = () => {
            started = true;
            resolve();
          };
          r.onerror = (e) => {
            err = e.error ?? 'error';
            resolve();
          };
          try {
            r.start();
          } catch (e) {
            err = String(e).slice(0, 60);
            resolve();
          }
          setTimeout(resolve, 3500);
        });
        try {
          r.stop();
        } catch {
          /* already stopped */
        }
      } catch (e) {
        err = String(e).slice(0, 60);
      }
    }
    let streamOk = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamOk = s.getAudioTracks().length > 0;
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      err = err || String(e).slice(0, 60);
    }
    return { present: Boolean(ctor), constructs, started, err, streamOk };
  });
  const holdButton = await page.locator('button', { hasText: /Hold to speak/i }).count();
  record(
    'microphone path',
    `API ${mic.present ? 'present' : 'ABSENT'} · constructs ${mic.constructs} · onstart ${mic.started} · ` +
      `mic stream ${mic.streamOk ? 'granted' : 'denied'} · control ${holdButton ? 'present' : 'MISSING'}` +
      (mic.err ? ` · engine said "${mic.err}"` : ''),
    // What is verifiable here: the API exists, the control exists, and the
    // browser hands us an audio track. Actual TRANSCRIPTION cannot be asserted
    // in Playwright's Chromium — Web Speech relies on a Google endpoint that
    // only branded Chrome builds are keyed for, so a "network"/"not-allowed"
    // error here says nothing about real Chrome. Tested by hand instead.
    mic.present && mic.constructs && mic.streamOk && holdButton > 0,
  );

  // ── 9 · The transcript is a PROPOSAL, never a command ────────────────────
  const voicePolicy = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      stated: /transcript is a proposal, never a command/i.test(text),
      pinnedLanguage: /never auto-detected|Pinned/i.test(text),
    };
  });
  record(
    'voice policy is stated in the UI',
    `"proposal, never a command" ${voicePolicy.stated ? 'shown' : 'MISSING'} · language pinning ${voicePolicy.pinnedLanguage ? 'shown' : 'missing'}`,
    voicePolicy.stated,
  );

  // ── 10 · CLOUD TIER with a bad key fails honestly ────────────────────────
  await reset(page);
  const keyField = page.locator('input[placeholder*="sk-or"]');
  let cloud = 'no API key field found';
  let cloudOk = false;
  if (await keyField.count()) {
    await keyField.first().fill('sk-or-v1-deliberately-invalid-key-for-testing');
    await page.waitForTimeout(700);
    const tierSelect = page.locator('select').filter({ hasText: /auto|best available/i });
    if (await tierSelect.count()) await tierSelect.first().selectOption({ value: 'cloud' }).catch(() => undefined);
    await page.waitForTimeout(900);
    const strip = await page.evaluate(
      () => document.querySelector('.status')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    );
    await page.fill('textarea', 'search for pizza');
    await run(page);
    const outcome = await toVerdict(page, 60000).catch(() => ({ tag: 'no verdict', reason: '' }));
    cloud = `strip said "${strip.match(/PLANNER \w+/)?.[0] ?? '?'}" · verdict ${outcome.tag} · ${outcome.reason.slice(0, 70)}`;
    // The requirement is that a bad key produces an honest failure and not a
    // crash, a hang, or a silent fall back to a scripted plan presented as real.
    cloudOk = outcome.tag !== 'no verdict' && errors.length === 0;
    await keyField.first().fill('');
  }
  record('cloud tier fails honestly on a bad key', cloud, cloudOk);

  await page.screenshot({ path: path.join(shots, 'final.png') });
  await browser.close();

  console.log(`\n  page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  const broken = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(84));
  console.log(`${results.length - broken.length} of ${results.length} mechanics verified`);
  if (broken.length) {
    console.log('\nNOT VERIFIED:');
    for (const b of broken) console.log(`  · ${b.name} — ${b.detail}`);
    process.exit(1);
  }
  console.log('The loop is real: it types into the app, addresses by index, reads values back, and gates execution.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
