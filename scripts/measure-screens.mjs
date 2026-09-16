/**
 * Measures what the DOM reader actually produces on real Tiffin, in a real
 * browser, with real layout.
 *
 * Gate 1 of the build asks for honest numbers: node counts before and after
 * pruning, the drop-reason histogram per screen, whether the clickable
 * restaurant card survives, and the true token cost per screen. A jsdom harness
 * cannot answer any of those, because without layout every rectangle is zero and
 * half the pruning rules never fire. So: Chromium, the built app, and the real
 * reader injected into the page.
 *
 * Token counts are reported twice — our cheap runtime heuristic, and a real BPE
 * tokenizer — because the deck quotes one number and it had better be the true one.
 */

import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { encode } from 'gpt-tokenizer';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps/tiffin/dist');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function serve(dir) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.join(dir, rel === '/' ? 'index.html' : rel);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

function histogram(dropped, overCap) {
  const parts = Object.entries(dropped)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${reason}:${n}`);
  if (overCap > 0) parts.push(`over-cap:${overCap}`);
  return parts.join(' ') || '(nothing dropped)';
}

async function main() {
  if (!existsSync(dist)) {
    console.error('Build Tiffin first:  pnpm --filter @tiffin/app build');
    process.exit(1);
  }

  const bundle = await build({
    entryPoints: [path.join(root, 'tooling/debug/src/measure-entry.ts')],
    bundle: true,
    format: 'iife',
    write: false,
    platform: 'browser',
    target: 'es2022',
  });
  const readerScript = bundle.outputFiles[0].text;

  const { server, port } = await serve(dist);
  const browser = await chromium.launch();
  // The demo's left pane, sized like a phone. Layout-dependent rules only mean
  // something at the size the judge will actually see.
  const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.tiffin');

  const measure = async (screenId) => {
    await page.addScriptTag({ content: readerScript });
    await page.waitForTimeout(120);
    return page.evaluate((id) => globalThis.__origoMeasure(id), screenId);
  };

  const results = [];

  // 1. search — the landing screen, all 15 restaurants
  results.push(await measure('search'));

  // 2. results — after a real search for biryani
  await page.fill('input[type="search"]', 'biryani');
  await page.waitForTimeout(200);
  results.push(await measure('results'));

  // 3. restaurant — after tapping the first card
  await page.click('.t-card');
  await page.waitForTimeout(200);
  results.push(await measure('restaurant'));

  // 4. cart — after adding an item and opening the cart
  await page.click('.t-add');
  await page.waitForTimeout(150);
  await page.click('[aria-label^="Cart,"]');
  await page.waitForTimeout(200);
  results.push(await measure('cart'));

  // 5. checkout
  await page.click('.t-primary');
  await page.waitForTimeout(250);
  results.push(await measure('checkout'));

  await browser.close();
  server.close();

  // ── Report ──────────────────────────────────────────────────────────────
  console.log('\nORIGO LOOP — DOM reader measurements (real Chromium, 420x780 pane)\n');
  console.log('screen      before  after  kept%  clk  est.tok  bpe.tok  histogram');
  console.log('─'.repeat(100));

  const rows = [];
  for (const r of results) {
    if (r.error) {
      console.log(`${r.screenId ?? '?'}  ERROR ${r.error}`);
      continue;
    }
    const bpe = encode(r.promptJson).length;
    const keptPct = r.before === 0 ? 0 : Math.round((r.after / r.before) * 100);
    rows.push({ ...r, bpe, keptPct });
    console.log(
      `${r.screenId.padEnd(11)} ${String(r.before).padStart(5)} ${String(r.after).padStart(6)} ${String(keptPct).padStart(5)}% ${String(r.clickableKept).padStart(4)} ${String(r.estimatedTokens).padStart(7)} ${String(bpe).padStart(8)}  ${histogram(r.dropped, r.overCap)}`,
    );
  }

  const bpes = rows.map((r) => r.bpe);
  const mean = Math.round(bpes.reduce((a, b) => a + b, 0) / bpes.length);
  console.log('─'.repeat(100));
  console.log(`mean ${mean} BPE tokens/screen · worst ${Math.max(...bpes)} · best ${Math.min(...bpes)}`);
  console.log(`a screenshot of one screen costs roughly 1500 tokens: ${(1500 / mean).toFixed(1)}x more than this.\n`);

  const resultsScreen = rows.find((r) => r.screenId === 'results');
  if (resultsScreen) {
    console.log('RESULTS SCREEN — the kept node list (does the clickable card survive?)\n');
    for (const n of resultsScreen.kept) {
      console.log(`  ${String(n.index).padStart(2)}  ${n.role.padEnd(6)} ${n.flags.padEnd(9)} ${n.text.slice(0, 62)}`);
    }
    console.log(`\n  prompt json (${resultsScreen.promptJson.length} chars):\n  ${resultsScreen.promptJson}\n`);
  }

  if (process.env.ORIGO_DUMP) {
    await writeFile(process.env.ORIGO_DUMP, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`full per-screen detail written to ${process.env.ORIGO_DUMP}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
