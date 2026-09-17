/**
 * Drives the DEPLOYED site in a real browser and reports what a judge sees.
 *
 *   node scripts/check-live.mjs https://origoloop.netlify.app
 *
 * verify-flows.mjs tests the local production build; this tests the thing at
 * the end of the link, which is the only artefact a judge ever touches. It
 * exists because "the deploy worked" and "the config is right" are different
 * claims, and only one of them can be checked from a config file.
 */

import { chromium } from 'playwright';
import path from 'node:path';
import process from 'node:process';

const url = process.argv[2] ?? 'https://origoloop.netlify.app';
const root = path.resolve(import.meta.dirname, '..');

const GOALS = [
  // The three preset goals a judge is most likely to press.
  { label: 'preset · cart total', button: 'Cart total under ₹500', expect: 'Pass' },
  { label: 'preset · guardrail', button: 'Guardrail · try to order', expect: 'Blocked' },
  { label: 'preset · fails on purpose', button: 'Fails on purpose', expect: 'Fail' },
];

/** A free-form goal, which is the case that behaves differently by tier. */
const FREEFORM = 'search for pizza and check that pizza restaurants appear';

async function main() {
  console.log(`Driving ${url}\n`);
  const browser = await chromium.launch({
    ignoreDefaultArgs: ['--disable-gpu'],
    args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url().slice(0, 90)} — ${r.failure()?.errorText}`));

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.tiffin', { timeout: 30000 });
  console.log(`  page usable in ${Date.now() - t0}ms`);

  await page.waitForTimeout(2200); // let the tier probe settle
  const strip = async () =>
    page.evaluate(() => document.querySelector('.status')?.innerText.replace(/\s+/g, ' ').trim() ?? 'NO STRIP');
  console.log(`  strip: ${await strip()}\n`);

  const runOnce = async (label, prepare, expect) => {
    const reset = page.locator('button', { hasText: 'Reset' });
    if (await reset.count()) await reset.first().click();
    await page.waitForTimeout(400);
    await prepare();
    await page.locator('button.btn-primary', { hasText: 'Run' }).click();

    // A destructive run stops on the confirmation sheet and waits for a human.
    const sheet = page.locator('.sheet');
    const verdict = page.locator('.verdict');
    await Promise.race([
      sheet.waitFor({ timeout: 90000 }).catch(() => undefined),
      verdict.waitFor({ timeout: 90000 }).catch(() => undefined),
    ]);
    if (await sheet.count()) {
      await page.locator('button', { hasText: 'Deny' }).click();
      await verdict.waitFor({ timeout: 30000 });
    }
    const got = await page.evaluate(() => ({
      tag: document.querySelector('.verdict-tag')?.textContent?.trim() ?? '?',
      reason: document.querySelector('.verdict-reason')?.textContent?.trim().slice(0, 150) ?? '',
      steps: document.querySelectorAll('.row').length,
    }));
    const ok = got.tag.toLowerCase().includes(expect.toLowerCase());
    console.log(`  ${ok ? 'ok    ' : 'DIFFERS'} ${label.padEnd(30)} → ${got.tag} (${got.steps} steps)`);
    if (!ok || got.reason) console.log(`         ${got.reason}`);
    return ok;
  };

  let allOk = true;
  for (const goal of GOALS) {
    const ok = await runOnce(goal.label, async () => {
      await page.locator('button', { hasText: goal.button }).first().click();
      await page.waitForTimeout(300);
    }, goal.expect);
    allOk = allOk && ok;
  }

  console.log('');
  // The free-form case: on the scripted tier this is EXPECTED to end Blocked,
  // and the reason string has to say why in a way a stranger can act on.
  await runOnce('free-form goal (no key)', async () => {
    await page.fill('textarea', FREEFORM);
    await page.waitForTimeout(300);
  }, 'Blocked');

  console.log('\n  page errors      :', consoleErrors.length ? consoleErrors.join(' | ') : 'none');
  console.log('  failed requests  :', failedRequests.length ? failedRequests.join(' | ') : 'none');

  await browser.close();
  void root;
  if (!allOk) {
    console.log('\nOne or more preset goals did not reach the expected verdict.');
    process.exit(1);
  }
  console.log('\nThe deployed link works: all three preset goals reach their expected verdict.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
