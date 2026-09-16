/**
 * The same DOM reader, on real public websites.
 *
 * This is the number that tells us most about Android: Tiffin is our own clean
 * React and prunes from 180 nodes. A real site is markedly denser and was built
 * by people who never heard of us — which is exactly the situation the
 * accessibility tree puts us in on a phone.
 *
 * Read-only. It loads pages and reads the DOM. It clicks nothing and submits
 * nothing.
 *
 *   node scripts/measure-real-sites.mjs
 */

import { build } from 'esbuild';
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { encode } from 'gpt-tokenizer';

const root = path.resolve(import.meta.dirname, '..');

/** Well-structured, non-destructive, and representative of different eras of markup. */
const SITES = [
  { name: 'Wikipedia article', url: 'https://en.wikipedia.org/wiki/Hyderabad' },
  { name: 'Wikipedia search results', url: 'https://en.wikipedia.org/w/index.php?search=biryani' },
  { name: 'MDN reference', url: 'https://developer.mozilla.org/en-US/docs/Web/API/fetch' },
  { name: 'example.com (minimal)', url: 'https://example.com/' },
];

async function main() {
  await mkdir(path.join(root, '.shots'), { recursive: true });

  const bundle = await build({
    entryPoints: [path.join(root, 'tooling/debug/src/measure-entry.ts')],
    bundle: true,
    format: 'iife',
    write: false,
    platform: 'browser',
    target: 'es2022',
  });
  const readerScript = bundle.outputFiles[0].text;

  const browser = await chromium.launch();
  // A phone-sized viewport, because that is the situation we are modelling.
  const page = await browser.newPage({ viewport: { width: 420, height: 780 } });

  const rows = [];
  for (const site of SITES) {
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1200);
      await page.addScriptTag({ content: readerScript });
      // The reader looks for `.tiffin`; on a real site the root is <body>.
      const measured = await page.evaluate((id) => {
        const el = document.body;
        el.classList.add('tiffin');
        const result = globalThis.__origoMeasure(id);
        el.classList.remove('tiffin');
        return result;
      }, site.name);

      if (measured.error) {
        rows.push({ ...site, error: measured.error });
        continue;
      }
      rows.push({
        ...site,
        before: measured.before,
        after: measured.after,
        dropped: measured.dropped,
        overCap: measured.overCap,
        clickableKept: measured.clickableKept,
        estimatedTokens: measured.estimatedTokens,
        bpe: encode(measured.promptJson).length,
        kept: measured.kept,
        promptJson: measured.promptJson,
      });
    } catch (cause) {
      rows.push({ ...site, error: String(cause).split('\n')[0].slice(0, 120) });
    }
  }

  await browser.close();

  console.log('\nORIGO LOOP — the same reader on REAL sites (420x780, read-only)\n');
  console.log('site                          before  after  kept%  clk  bpe.tok  cap binds  histogram');
  console.log('-'.repeat(118));
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.name.padEnd(29)} ERROR ${r.error}`);
      continue;
    }
    const pct = Math.round((r.after / r.before) * 100);
    const hist = Object.entries(r.dropped)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}:${n}`)
      .join(' ');
    console.log(
      `${r.name.padEnd(29)} ${String(r.before).padStart(6)} ${String(r.after).padStart(6)} ${String(pct).padStart(5)}% ${String(r.clickableKept).padStart(4)} ${String(r.bpe).padStart(8)}  ${(r.overCap > 0 ? `YES (+${r.overCap})` : 'no').padStart(9)}  ${hist}`,
    );
  }

  const ok = rows.filter((r) => !r.error);
  if (ok.length > 0) {
    const bpes = ok.map((r) => r.bpe);
    const befores = ok.map((r) => r.before);
    console.log('-'.repeat(118));
    console.log(
      `mean ${Math.round(bpes.reduce((a, b) => a + b, 0) / bpes.length)} BPE tokens · worst ${Math.max(...bpes)} · ` +
        `raw nodes ${Math.min(...befores)}-${Math.max(...befores)} (Tiffin's densest screen: 180)`,
    );
    console.log(
      `the 40-node cap binds on ${ok.filter((r) => r.overCap > 0).length} of ${ok.length} sites ` +
        `(on Tiffin it never binds)`,
    );

    const busiest = ok.reduce((a, b) => (a.before > b.before ? a : b));
    console.log(`\nDENSEST SITE — ${busiest.name}: the kept node list\n`);
    for (const n of busiest.kept.slice(0, 40)) {
      console.log(`  ${String(n.index).padStart(2)}  ${n.role.padEnd(6)} ${n.flags.padEnd(9)} ${n.text.slice(0, 58)}`);
    }
  }

  await writeFile(path.join(root, '.shots/real-sites.json'), JSON.stringify(rows, null, 2), 'utf8');
  console.log('\nfull detail written to .shots/real-sites.json\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
