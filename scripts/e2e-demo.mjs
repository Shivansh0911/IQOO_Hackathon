/**
 * Drives the built demo in a real browser and reports what actually happened.
 *
 * This is the first genuine end-to-end run: real Tiffin, the real DOM reader,
 * the real validator, the real guardrails, the real executor. The planner is the
 * mock tier, so the PLAN is scripted — but everything the plan passes through is
 * the production path, which is the part that can break.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const dist = path.resolve(import.meta.dirname, '../apps/demo/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(dist, rel === '/' ? 'index.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('.tiffin');

const goal = process.argv[2] ?? 'add an item from the first restaurant and check the cart total is under 500';
const shot = process.argv[3] ?? '.shots/demo.png';
const allow = process.argv[4] === 'allow';

await page.fill('textarea', goal);
await page.click('button:has-text("Run")');

// Answer the confirmation sheet if the destructive gate fires.
const sheet = page.locator('.sheet');
try {
  await sheet.waitFor({ timeout: 4000 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: shot.replace('.png', '-confirm.png') });
  await page.click(allow ? 'button:has-text("Allow once")' : 'button:has-text("Deny")');
} catch {
  // No confirmation needed for this goal.
}

await page.waitForSelector('.verdict', { timeout: 30000 });
await page.screenshot({ path: shot });

const summary = await page.evaluate(() => {
  const verdict = document.querySelector('.verdict-tag')?.textContent ?? '?';
  const reason = document.querySelector('.verdict-reason')?.textContent ?? '';
  const meta = document.querySelector('.verdict-meta')?.textContent ?? '';
  const status = document.querySelector('.status')?.textContent ?? '';
  const steps = [...document.querySelectorAll('.row')].map((r) => ({
    n: r.querySelector('.row-n')?.textContent,
    reason: r.querySelector('.row-reason')?.textContent,
    json: r.querySelector('.row-json')?.textContent,
  }));
  const insets = [...document.querySelectorAll('.row-inset')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
  return { verdict, reason, meta, status, steps, insets };
});

console.log(`\nGOAL: ${goal}`);
console.log(`STATUS STRIP: ${summary.status.replace(/\s+/g, ' ').trim()}`);
console.log(`\nSTEPS:`);
for (const s of summary.steps) console.log(`  ${s.n}  ${s.reason}\n      ${s.json}`);
if (summary.insets.length) {
  console.log(`\nINSET ROWS (rejections / stuck / destructive):`);
  for (const i of summary.insets) console.log(`  · ${i}`);
}
console.log(`\nVERDICT: ${summary.verdict} — ${summary.reason}`);
console.log(`         ${summary.meta}\n`);

// Capture the report the run produced, so we can look at the real artefact.
if (process.env.ORIGO_REPORT) {
  const html = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Download HTML'));
    if (!button) return null;
    // Intercept the blob rather than downloading it, so the script can read it.
    const created = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      created.push(blob);
      return original.call(URL, blob);
    };
    button.click();
    URL.createObjectURL = original;
    return created[0] ? await created[0].text() : null;
  });
  if (html) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.ORIGO_REPORT, html, 'utf8');
    console.log(`report written to ${process.env.ORIGO_REPORT} (${html.length} bytes)`);
  } else {
    console.log('no report button found');
  }
}

await browser.close();
server.close();
