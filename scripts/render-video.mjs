/**
 * Renders the whole submission video to ONE mp4. Nothing to install, nothing to
 * edit, no voiceover required.
 *
 *   pnpm video
 *   node scripts/render-video.mjs --url https://origo-loop.netlify.app
 *
 * Output: .shots/video/origo-demo.mp4 — 1920x1080, H.264, ~3 minutes.
 *
 * The video must be fully comprehensible MUTED, because a judge may well watch
 * it that way. So every recorded clip carries a burned-in caption strip with
 * the narration line for that moment, and every section is introduced by a card
 * that states the argument rather than labelling the footage.
 *
 * Captions are parsed out of docs/VIDEO_SCRIPT.md rather than duplicated here:
 * the script is the single source of truth for what is said and for how long,
 * so editing the script re-times the video.
 *
 * ffmpeg comes from @ffmpeg-installer/ffmpeg, a devDependency that ships the
 * binary inside the npm tarball. (ffmpeg-static downloads from GitHub releases
 * on install and that download fails on this network; Playwright's bundled
 * ffmpeg is built --disable-everything and has no libx264, drawtext or tpad.)
 */

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { titleCard, sectionCard, statementCard, closingCard } from './video-cards.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const videoDir = path.join(root, '.shots/video');
const workDir = path.join(videoDir, '.render');
const OUTPUT = path.join(videoDir, 'origo-demo.mp4');

const FPS = 25;
const W = 1920;
const H = 1080;

const REPO = 'github.com/Shivansh0911/IQOO_Hackathon';
const TEAM = 'Tushya Jain · Shivansh Ojha — BITS Pilani Hyderabad';

/** --url replaces the closing card's live-demo line, so a re-render after
 * deploying is one command. */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const LIVE_URL = argValue('--url') ?? '[ paste the Netlify URL here ]';

const FFMPEG = require('@ffmpeg-installer/ffmpeg').path;

/** drawtext needs a real font file; fontconfig names are not portable enough. */
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/segoeui.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];
const FONT = FONT_CANDIDATES.find((f) => existsSync(f));

function ff(args, label) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    maxBuffer: 1e8,
  });
  if (r.status !== 0) {
    console.error(`\nffmpeg failed: ${label}`);
    console.error((r.stderr ?? '').trim().split('\n').slice(-10).join('\n'));
    process.exit(1);
  }
}

function durationOf(file) {
  const r = spawnSync(FFMPEG, ['-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * The video's shape. `clips` are recorded footage; a section with no clips is a
 * statement card that carries its narration as body text, because there is no
 * footage for it — those are the two segments a human would otherwise film.
 *
 * `script` names the heading in docs/VIDEO_SCRIPT.md whose narration table
 * supplies this section's captions.
 */
const SECTIONS = [
  {
    script: 'THE PROBLEM',
    heading: 'THE PROBLEM',
    context: 'Testing a phone app still needs a laptop.',
    statement: true,
  },
  {
    script: 'THE INSIGHT',
    heading: 'THE INSIGHT',
    context: '438 tokens per screen, not 1,500. We read structure, not pixels.',
    clips: ['clip-02-tokens'],
  },
  {
    script: 'IT WORKS',
    heading: 'IT WORKS',
    context: 'A spoken goal, executed one validated action at a time — and verified.',
    clips: ['clip-01-goal'],
  },
  {
    script: 'IT VERIFIES',
    heading: 'IT VERIFIES',
    context: 'A green Pass only means something if a wrong expectation goes red.',
    clips: ['clip-04-fail'],
  },
  {
    script: 'IT IS SAFE',
    heading: 'IT IS SAFE',
    context: 'The model picks from a numbered menu, so a made-up answer is provably invalid.',
    clips: ['clip-03-guardrail'],
    scriptLines: [1, 4], // the guardrail half of the IT IS SAFE table
  },
  {
    script: 'IT IS SAFE',
    heading: 'WHEN THE MODEL IS WRONG',
    context: '15 rejections in 20 calls. Every one caught before it reached the app.',
    clips: ['clip-05-rejects'],
    scriptLines: [5, 11], // the rejections half
  },
  {
    script: 'IT PORTS',
    heading: 'IT PORTS',
    context: 'The same agent core, three surfaces.',
    statement: true,
  },
];

const CARD_SECONDS = 4;
const TITLE_SECONDS = 6;
const CLOSING_SECONDS = 10;
/** Height of the burned-in caption band. Footage is letterboxed above it. */
const BAND_H = 168;

/**
 * Pulls the narration tables out of docs/VIDEO_SCRIPT.md.
 *
 * Returns, per section heading, the list of { text, secs }. Stage directions —
 * the italic *(beat)* rows — are kept, because they are real pauses in the
 * timing, but they carry no caption.
 */
async function parseScript() {
  const md = await readFile(path.join(root, 'docs/VIDEO_SCRIPT.md'), 'utf8');
  const sections = new Map();
  let current = null;

  for (const line of md.split('\n')) {
    // Handles both '### 0:18 – 0:45 · THE INSIGHT — ...' and '### IT VERIFIES · ...'
    const heading = /^###\s+(?:.*?·\s*)?([A-Z][A-Z ,]{2,}?)\s*(?:—|·|$)/.exec(line);
    if (heading?.[1]) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!current) continue;

    // | 3 | "narration" | 5 |
    const row = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|/.exec(line);
    if (!row?.[2] || !row[3]) continue;
    const raw = row[2].trim();
    const isDirection = raw.startsWith('*(');
    const text = raw.replace(/^"|"$/g, '').replace(/\*\((.*)\)\*/, '').trim();
    sections.get(current)?.push({
      text: isDirection ? '' : text,
      secs: Number(row[3]),
    });
  }
  return sections;
}

/** Renders one HTML card to a PNG via a real browser. */
async function renderCards(cards) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const card of cards) {
    // networkidle, not load: the display face comes from Google Fonts and a
    // screenshot taken before it arrives silently ships the fallback.
    await page.setContent(card.html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    await page.waitForTimeout(120);
    await page.screenshot({ path: card.png, type: 'png' });
  }
  await browser.close();
}

/** A still PNG held for N seconds, as an mp4 segment. */
function encodeStill(png, seconds, out) {
  ff(
    [
      '-y', '-loop', '1', '-framerate', String(FPS), '-i', png,
      '-t', String(seconds),
      '-vf', `scale=${W}:${H},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(FPS),
      out,
    ],
    `still ${path.basename(png)}`,
  );
}

/** drawtext is given its text via a file, which avoids escaping entirely. */
function wrap(text, max = 78) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max) {
      lines.push(line.trim());
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).join('\n');
}

/**
 * One clip, normalised and captioned.
 *
 * Normalising (scale, fps, SAR, pixel format) happens here rather than at
 * concat time: the clips are VP8 at whatever size Playwright produced, and
 * concatenating streams that disagree on any of those produces either a hard
 * failure or silent garbage.
 */
async function encodeClip(clip, captions, index) {
  const src = path.join(videoDir, clip, `${clip}.webm`);
  const real = durationOf(src);
  if (real === null) {
    console.error(`\nCannot read ${path.relative(root, src)} — it may be truncated.`);
    console.error(`Re-record it:  pnpm record`);
    process.exit(1);
  }

  // Trim the page-load flash at the head and the tail cut.
  const head = 0.6;
  const usable = Math.max(1, real - head - 0.1);
  const narration = captions.reduce((sum, c) => sum + c.secs, 0);
  // If the narration outlasts the footage, freeze the final frame rather than
  // slowing the footage down — a demo must never look slower than it is.
  const hold = Math.max(0, narration - usable);
  const total = usable + hold;

  // The footage is letterboxed ABOVE the caption band rather than sitting under
  // a translucent strip. Measured reason: the destructive-confirmation sheet
  // renders at the bottom of the page, so an overlaid band covered its Approve
  // and Deny buttons — occluding the single most important frame in the video.
  // Nothing is ever drawn over footage now.
  const bandTop = H - BAND_H;
  const filters = [
    `scale=${W}:${bandTop}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:0:color=0x0e0e0e`,
    'setsar=1',
    `fps=${FPS}`,
  ];
  if (hold > 0.05) filters.push(`tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}`);

  filters.push(`drawbox=x=0:y=${bandTop}:w=${W}:h=${BAND_H}:color=0x0e0e0e:t=fill`);
  filters.push(`drawbox=x=0:y=${bandTop}:w=${W}:h=4:color=0xf5b400:t=fill`);

  // A scripted silent beat — *(hold, let it land)* — carries no text of its
  // own. Leaving it blank drops the caption band to empty mid-segment, which
  // reads as a rendering bug rather than a pause, so its seconds are folded
  // into the previous line and that line simply stays up. This is what a human
  // editor would do with the same beat.
  const held = [];
  for (const caption of captions) {
    const previous = held.at(-1);
    if (!caption.text && previous) previous.secs += caption.secs;
    else held.push({ ...caption });
  }

  // One drawtext per caption, shown only during its own window.
  let at = 0;
  for (const [i, caption] of held.entries()) {
    const from = at;
    at += caption.secs;
    if (!caption.text) continue; // a scripted pause carries no caption
    const tf = path.join(workDir, `cap-${index}-${i}.txt`);
    await writeFile(tf, wrap(caption.text), 'utf8');
    const tfArg = tf.replace(/\\/g, '/').replace(/:/g, '\\:');
    filters.push(
      `drawtext=fontfile='${FONT?.replace(/:/g, '\\:')}':textfile='${tfArg}':` +
        `fontcolor=0xf7f5ef:fontsize=40:line_spacing=12:x=70:y=${bandTop + 40}:` +
        `enable='between(t,${from.toFixed(2)},${Math.min(at, total).toFixed(2)})'`,
    );
  }

  const out = path.join(workDir, `seg-${String(index).padStart(2, '0')}.mp4`);
  ff(
    [
      '-y', '-ss', String(head), '-i', src,
      '-vf', filters.join(','),
      '-t', total.toFixed(2),
      '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      out,
    ],
    `clip ${clip}`,
  );
  return { out, seconds: total, source: real, hold, narration };
}

async function main() {
  if (!FONT) {
    console.error('No usable font found for captions. Looked for:\n  ' + FONT_CANDIDATES.join('\n  '));
    process.exit(1);
  }

  // Fail loudly and specifically on a missing clip — never emit a short video.
  const needed = SECTIONS.flatMap((s) => s.clips ?? []);
  const missing = needed.filter((c) => !existsSync(path.join(videoDir, c, `${c}.webm`)));
  if (missing.length) {
    console.error('\nMissing recorded clips:\n');
    for (const c of missing) console.error(`  ${path.relative(root, path.join(videoDir, c, `${c}.webm`))}`);
    console.error('\nRe-record all five with:\n');
    console.error('  npx vite build apps/demo');
    console.error('  pnpm record\n');
    console.error('Or, against the deployed site:\n  node scripts/record-demo.mjs https://your-site.netlify.app\n');
    process.exit(1);
  }

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const script = await parseScript();
  const missingScript = SECTIONS.filter((s) => !script.get(s.script)?.length);
  if (missingScript.length) {
    console.error(`docs/VIDEO_SCRIPT.md has no narration table for: ${missingScript.map((s) => s.script).join(', ')}`);
    process.exit(1);
  }

  // ── Build the card PNGs in one browser session ────────────────────────────
  const cards = [];
  const pngFor = (n) => path.join(workDir, `card-${n}.png`);

  cards.push({ png: pngFor('title'), html: titleCard({ team: TEAM }) });

  for (const [i, section] of SECTIONS.entries()) {
    const rows = script.get(section.script) ?? [];
    const range = section.scriptLines;
    const picked = range ? rows.slice(range[0] - 1, range[1]) : rows;
    section.captions = picked;

    // A statement card has no footage behind it, so it carries the narration
    // itself; a section card carries one line of argument over the coming clip.
    cards.push({
      png: pngFor(`s${i}`),
      html: section.statement
        ? statementCard({
            index: i + 1,
            heading: section.heading,
            lines: picked.filter((r) => r.text).map((r) => r.text),
          })
        : sectionCard({ index: i + 1, heading: section.heading, context: section.context }),
    });
  }

  cards.push({
    png: pngFor('closing'),
    html: closingCard({
      repo: REPO,
      liveUrl: LIVE_URL,
      proven: [
        '438 tokens per screen, measured with a real BPE tokenizer — 3.4× smaller than a screenshot.',
        'Nothing unvalidated ever reaches the app: 15 bad model outputs in 20 calls, all caught.',
      ],
      open: 'No small model has yet finished a multi-step task on the local tier. The architecture is done; the model is the gap.',
    }),
  });

  console.log(`ffmpeg  ${path.relative(root, FFMPEG).slice(0, 70)}…`);
  console.log(`font    ${FONT}`);
  console.log(`\nRendering ${cards.length} cards in a real browser…`);
  await renderCards(cards);

  // ── Encode every segment ──────────────────────────────────────────────────
  const segments = [];
  const rows = [];
  let index = 0;

  const addStill = (png, seconds, label, note) => {
    const out = path.join(workDir, `seg-${String(index).padStart(2, '0')}.mp4`);
    encodeStill(png, seconds, out);
    segments.push(out);
    rows.push({ label, seconds, note });
    index += 1;
  };

  addStill(pngFor('title'), TITLE_SECONDS, 'TITLE CARD', 'Origo Loop · team line');

  for (const [i, section] of SECTIONS.entries()) {
    const captions = section.captions ?? [];
    if (section.statement) {
      // A statement card is held for as long as its narration would run, so a
      // muted viewer has time to read every line.
      const secs = Math.max(8, captions.reduce((s, c) => s + c.secs, 0));
      addStill(pngFor(`s${i}`), secs, `CARD ${section.heading}`, `${captions.filter((c) => c.text).length} lines, no footage`);
      continue;
    }
    addStill(pngFor(`s${i}`), CARD_SECONDS, `CARD ${section.heading}`, section.context.slice(0, 52) + '…');

    // Captions are shared across the section's clips in order.
    let pool = [...captions];
    for (const clip of section.clips ?? []) {
      // Give each clip a share of the section's caption lines proportional to
      // how many clips remain, so a two-clip section splits its narration.
      const remaining = (section.clips ?? []).length - (section.clips ?? []).indexOf(clip);
      const take = remaining === 1 ? pool.length : Math.ceil(pool.length / remaining);
      const mine = pool.slice(0, take);
      pool = pool.slice(take);

      const made = await encodeClip(clip, mine, index);
      segments.push(made.out);
      rows.push({
        label: clip,
        seconds: made.seconds,
        note: `src ${made.source.toFixed(1)}s${made.hold > 0.05 ? ` +${made.hold.toFixed(1)}s freeze` : ''} · ${mine.filter((c) => c.text).length} captions`,
      });
      index += 1;
    }
  }

  addStill(pngFor('closing'), CLOSING_SECONDS, 'CLOSING CARD', `proven ×2, open ×1 · ${LIVE_URL}`);

  // ── Concat ────────────────────────────────────────────────────────────────
  const list = path.join(workDir, 'segments.txt');
  await writeFile(list, segments.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  // Every segment is already the same codec, geometry, SAR and rate, so a
  // stream copy is safe and lossless here.
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUTPUT], 'concat');

  // ── Report ────────────────────────────────────────────────────────────────
  const total = durationOf(OUTPUT) ?? 0;
  const bytes = (await stat(OUTPUT)).size;
  const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  console.log('\nSEGMENTS');
  console.log('-'.repeat(100));
  let at = 0;
  for (const r of rows) {
    console.log(
      `${stamp(at).padStart(5)} → ${stamp(at + r.seconds).padEnd(5)} ${r.seconds.toFixed(1).padStart(6)}s  ${r.label.padEnd(26)} ${r.note}`,
    );
    at += r.seconds;
  }
  console.log('-'.repeat(100));
  console.log(`DURATION ${stamp(total)} (${total.toFixed(1)}s) · ${(bytes / 1e6).toFixed(1)}MB · ${W}x${H} H.264`);
  console.log(`\n  ${path.relative(root, OUTPUT)}\n`);

  if (total < 180 || total > 240) {
    console.error(`DURATION OUT OF RANGE: ${stamp(total)} is not between 3:00 and 4:00.`);
    console.error('Adjust the narration in docs/VIDEO_SCRIPT.md — it drives the timing.');
    process.exit(1);
  }
  if (bytes > 200e6) {
    console.error(`FILE TOO LARGE: ${(bytes / 1e6).toFixed(0)}MB exceeds the 200MB limit.`);
    process.exit(1);
  }

  await rm(workDir, { recursive: true, force: true });
  void readdir;
  console.log('Re-render with the live URL after deploying:');
  console.log('  node scripts/render-video.mjs --url https://your-site.netlify.app\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
