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
import { synthesise, ambientBed, mixNarration, loudnessOf, streamsOf } from './video-audio.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const videoDir = path.join(root, '.shots/video');
const workDir = path.join(videoDir, '.render');
const OUTPUT = path.join(videoDir, 'origo-demo.mp4');
/** The narration timing, written beside the video so sync is checkable. */
const PLAN_FILE = path.join(videoDir, 'origo-demo.audio.json');

const FPS = 25;
const W = 1920;
const H = 1080;

const REPO = 'github.com/Shivansh0911/IQOO_Hackathon';
const NAMES = ['Tushya Jain', 'Shivansh Shekher Ojha'];
const AFFILIATION = 'BITS Pilani, Hyderabad Campus';
const TEAM = `${NAMES.join(' · ')} — ${AFFILIATION}`;

/** --url replaces the closing card's live-demo line, so a re-render after
 * deploying is one command. */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const LIVE_URL = argValue('--url') ?? '[ paste the Netlify URL here ]';
/** --no-audio renders the silent cut; the default is the narrated one. */
const WANT_AUDIO = !process.argv.includes('--no-audio');
/** The script section narrated over the closing card. */
const CLOSING_SCRIPT_SECTION = 'WHO, AND WHAT IS OPEN';
/**
 * Speech rate on the engine's -10..10 scale, where 0 is the default pace.
 *
 * Set to 2, a little above default. Measured reason: at 0 the synthesiser took
 * 252 seconds to read the script and the finished video came out at 5:04, well
 * past the four-minute cap, with clips frozen for up to 27 seconds to wait for
 * the voice. At 2 it reads in 203 seconds and the video lands at 3:58.
 *
 * Deliberately NOT pushed higher. The brief was explicit that the narration
 * must not sound rushed, so the remaining difference is absorbed by the
 * timeline — see fitBeatsToSpeech — rather than by talking faster.
 */
const SPEECH_RATE = 2;

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
    // Strip any *(stage direction)* and keep whatever narration is left.
    //
    // Treating a cell that merely STARTS with a direction as pure direction
    // threw away real narration: row 5 of the IT IS SAFE table reads
    // *(cut to clip-05)* "Now the part nobody else will show you." — and that
    // line was silently missing from both the audio and the captions until a
    // frame check showed a card with no caption on it. A row is only a pause
    // if nothing survives the strip.
    const text = raw
      .replace(/\*\([^)]*\)\*/g, '')
      .trim()
      .replace(/^"|"$/g, '')
      .trim();
    sections.get(current)?.push({ text, secs: Number(row[3]) });
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

/**
 * The caption band and one timed drawtext per spoken beat.
 *
 * Shared by stills and clips, because narration can begin over a section card
 * and continue onto the footage — so a card has to be able to caption itself.
 * Without this, a beat moved onto a card would be spoken but never written, and
 * the promise that the audio and the captions always agree would quietly break.
 */
async function captionFilters({ beats, tag, bandTop, limitSeconds }) {
  const filters = [
    `drawbox=x=0:y=${bandTop}:w=${W}:h=${BAND_H}:color=0x0e0e0e:t=fill`,
    `drawbox=x=0:y=${bandTop}:w=${W}:h=4:color=0xf5b400:t=fill`,
  ];
  let at = 0;
  for (const [i, beat] of beats.entries()) {
    const from = at;
    at += beat.secs;
    if (!beat.text) continue;
    const textFile = path.join(workDir, `cap-${tag}-${i}.txt`);
    await writeFile(textFile, wrap(beat.text), 'utf8');
    const textArg = textFile.replace(/\\/g, '/').replace(/:/g, '\\:');
    filters.push(
      `drawtext=fontfile='${FONT?.replace(/:/g, '\\:')}':textfile='${textArg}':` +
        `fontcolor=0xf7f5ef:fontsize=40:line_spacing=12:x=70:y=${bandTop + 40}:` +
        `enable='between(t,${from.toFixed(2)},${Math.min(at, limitSeconds).toFixed(2)})'`,
    );
  }
  return filters;
}

/** A still PNG held for N seconds, optionally captioned, as an mp4 segment. */
async function encodeStill(png, seconds, out, beats, tag) {
  const spoken = (beats ?? []).some((b) => b.text);
  const filters = [`scale=${W}:${H}`];
  if (spoken) {
    filters.push(
      ...(await captionFilters({ beats: beats ?? [], tag: `card-${tag}`, bandTop: H - BAND_H, limitSeconds: seconds })),
    );
  }
  filters.push('format=yuv420p');

  ff(
    [
      '-y', '-loop', '1', '-framerate', String(FPS), '-i', png,
      '-t', String(seconds),
      '-vf', filters.join(','),
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

  // `captions` is already merged and timed by planBeats(), so the drawtext
  // windows and the narration timestamps come from the same numbers — which is
  // what keeps the spoken line and the written line on screen together.
  filters.push(...(await captionFilters({ beats: captions, tag: String(index), bandTop, limitSeconds: total })));

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

/** A natural gap after each spoken line, so sections do not run together. */
const PAUSE_AFTER_LINE = 0.4;

/**
 * The longest a clip may sit on a frozen final frame.
 *
 * Beyond this the narration moves onto the preceding section card instead. A
 * freeze of a few seconds reads as a deliberate hold; twenty-seven seconds
 * reads as a broken player, which is what the first narrated render produced.
 */
const MAX_FREEZE_SECONDS = 5;

/** How much of a clip is left after the head flash and the tail cut. */
function usableSecondsOf(clip) {
  const real = durationOf(path.join(videoDir, clip, `${clip}.webm`));
  return real === null ? 0 : Math.max(1, real - 0.6 - 0.1);
}

/**
 * Folds scripted silent beats into the line before them.
 *
 * A row like *(hold, let it land)* carries no text. Left as its own window it
 * drops the caption band to empty mid-segment, which reads as a rendering bug
 * rather than a pause — so its seconds extend the previous line and that line
 * simply stays up, which is what a human editor would do with the same beat.
 */
function planBeats(rows) {
  const beats = [];
  for (const row of rows) {
    const previous = beats.at(-1);
    if (!row.text && previous) previous.secs += row.secs;
    else beats.push({ ...row });
  }
  return beats;
}

/**
 * Widens each beat to fit the speech actually synthesised for it.
 *
 * The seconds in VIDEO_SCRIPT.md were written for a human reading aloud and the
 * synthesiser does not match them line for line. Two ways to reconcile that:
 * speed the voice up until it fits, or let the timeline breathe. Speeding it up
 * is how narration ends up sounding robotic, so the timeline gives way instead
 * — the footage freezes or a card holds a moment longer, and nothing is rushed.
 */
function fitBeatsToSpeech(beats) {
  for (const beat of beats) {
    if (beat.speech) beat.secs = Math.max(beat.secs, beat.speech + PAUSE_AFTER_LINE);
  }
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
    // Merge silent beats now, so one list drives the captions, the segment
    // lengths and the narration timestamps alike.
    section.captions = planBeats(picked);
    for (const beat of section.captions) beat.scriptSecs = beat.secs;

    // A statement card has no footage behind it, so it carries the narration
    // itself; a section card carries one line of argument over the coming clip.
    cards.push({
      png: pngFor(`s${i}`),
      html: section.statement
        ? statementCard({
            index: i + 1,
            heading: section.heading,
            lines: (section.captions ?? []).filter((r) => r.text).map((r) => r.text),
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
      names: NAMES,
      affiliation: AFFILIATION,
    }),
  });

  // ── Narration, BEFORE any video is encoded ────────────────────────────────
  //
  // Order matters: the synthesised speech decides how long each beat needs to
  // be, and the beats decide how long each segment is. Encoding first and
  // adding audio afterwards would mean either a voice racing the visuals or a
  // second render pass.
  const closingBeats = planBeats(script.get(CLOSING_SCRIPT_SECTION) ?? []);
  for (const beat of closingBeats) beat.scriptSecs = beat.secs;
  if (WANT_AUDIO && !closingBeats.length) {
    console.error(`docs/VIDEO_SCRIPT.md has no narration table for "${CLOSING_SCRIPT_SECTION}".`);
    process.exit(1);
  }

  const allBeats = [...SECTIONS.flatMap((section) => section.captions ?? []), ...closingBeats];
  const spoken = allBeats.filter((beat) => beat.text);
  let voiceName = null;

  if (WANT_AUDIO) {
    console.log(`
Synthesising ${spoken.length} narration lines…`);
    const speech = await synthesise({ lines: spoken, dir: path.join(workDir, 'speech'), rate: SPEECH_RATE });
    if (!speech.ok) {
      console.error(`
${speech.error}`);
      console.error('Render the silent cut instead with:  node scripts/render-video.mjs --no-audio');
      process.exit(1);
    }
    voiceName = speech.voice;
    for (const [i, beat] of spoken.entries()) {
      const file = speech.files[i]?.file;
      const seconds = file ? durationOf(file) : null;
      if (!file || seconds === null) {
        console.error(`No audio produced for narration line ${i + 1}: "${beat.text.slice(0, 60)}…"`);
        process.exit(1);
      }
      beat.file = file;
      beat.speech = seconds;
    }
    fitBeatsToSpeech(allBeats);

    const stretched = spoken.filter((b) => b.speech + PAUSE_AFTER_LINE > b.scriptSecs).length;
    console.log(
      `  voice ${voiceName} at rate ${SPEECH_RATE} · ` +
        `${spoken.reduce((t, b) => t + b.speech, 0).toFixed(1)}s of speech · ` +
        `${stretched} of ${spoken.length} beats widened to fit it`,
    );
  }

  console.log(`ffmpeg  ${path.relative(root, FFMPEG).slice(0, 70)}…`);
  console.log(`font    ${FONT}`);
  console.log(`\nRendering ${cards.length} cards in a real browser…`);
  await renderCards(cards);

  // ── Encode every segment ──────────────────────────────────────────────────
  const segments = [];
  const rows = [];
  let index = 0;

  // `cursor` is the absolute position on the finished timeline. Every narration
  // line records the moment it should be heard, so the mix places speech at the
  // same instants the captions appear rather than at guessed offsets.
  let cursor = 0;
  /** @type {{ file: string, at: number, speech: number, text: string }[]} */
  const narration = [];

  const scheduleBeats = (beats, from) => {
    let at = from;
    for (const beat of beats) {
      if (beat.text && beat.file && beat.speech) {
        narration.push({ file: beat.file, at, speech: beat.speech, text: beat.text });
      }
      at += beat.secs;
    }
  };

  const addStill = async (png, seconds, label, note, { schedule, caption } = {}) => {
    const out = path.join(workDir, `seg-${String(index).padStart(2, '0')}.mp4`);
    // `caption` is passed only for section cards that inherited spoken lines.
    // Statement cards already print their narration as body text, so a band
    // over the top would render every line twice.
    await encodeStill(png, seconds, out, caption, index);
    segments.push(out);
    rows.push({ label, seconds, note });
    if (schedule) scheduleBeats(schedule, cursor);
    cursor += seconds;
    index += 1;
  };

  await addStill(pngFor('title'), TITLE_SECONDS, 'TITLE CARD', 'Origo Loop · team line');

  for (const [i, section] of SECTIONS.entries()) {
    const captions = section.captions ?? [];
    if (section.statement) {
      // A statement card is held for as long as its narration runs, so a muted
      // viewer has time to read every line and a listening one hears it all.
      const secs = Math.max(8, captions.reduce((sum, c) => sum + c.secs, 0));
      await addStill(
        pngFor(`s${i}`),
        secs,
        `CARD ${section.heading}`,
        `${captions.filter((c) => c.text).length} lines, no footage`,
        { schedule: captions },
      );
      continue;
    }

    // Split the section's narration between its card and its footage.
    //
    // Synthesised speech runs appreciably longer than the human timings in the
    // script, and parking all of it on the clip meant freezing the last frame
    // for as long as twenty-seven seconds — measured, and unwatchable. So the
    // opening lines play over the section card, which holds for exactly as long
    // as they take, and only what the footage can carry stays on the footage.
    // This is what a human editor does with a title card, and it caps the
    // freeze at MAX_FREEZE_SECONDS.
    const clip = (section.clips ?? [])[0];
    const usable = clip ? usableSecondsOf(clip) : 0;
    const cardBeats = [];
    const clipBeats = [...captions];
    while (
      clipBeats.length > 1 &&
      clipBeats.reduce((sum, b) => sum + b.secs, 0) > usable + MAX_FREEZE_SECONDS
    ) {
      const moved = clipBeats.shift();
      if (moved) cardBeats.push(moved);
    }

    const cardSeconds = cardBeats.length
      ? Math.max(CARD_SECONDS, cardBeats.reduce((sum, b) => sum + b.secs, 0))
      : CARD_SECONDS;
    await addStill(
      pngFor(`s${i}`),
      cardSeconds,
      `CARD ${section.heading}`,
      cardBeats.length ? `${cardBeats.length} line(s) narrated over the card` : section.context.slice(0, 44) + '…',
      { schedule: cardBeats, caption: cardBeats.length ? cardBeats : undefined },
    );

    if (!clip) continue;
    const made = await encodeClip(clip, clipBeats, index);
    segments.push(made.out);
    rows.push({
      label: clip,
      seconds: made.seconds,
      note: `src ${made.source.toFixed(1)}s${made.hold > 0.05 ? ` +${made.hold.toFixed(1)}s freeze` : ''} · ${clipBeats.filter((c) => c.text).length} captions`,
    });
    scheduleBeats(clipBeats, cursor);
    cursor += made.seconds;
    index += 1;
  }

  // The closing card holds long enough to speak the whole close, including the
  // two lines about what is still open. Those are the last thing said, on
  // purpose.
  const closingSeconds = WANT_AUDIO
    ? Math.max(CLOSING_SECONDS, closingBeats.reduce((sum, b) => sum + b.secs, 0))
    : CLOSING_SECONDS;
  await addStill(pngFor('closing'), closingSeconds, 'CLOSING CARD', `proven ×2, open ×1 · ${LIVE_URL}`, {
    schedule: WANT_AUDIO ? closingBeats : undefined,
  });

  // ── Concat ────────────────────────────────────────────────────────────────
  const list = path.join(workDir, 'segments.txt');
  await writeFile(list, segments.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  // Every segment is already the same codec, geometry, SAR and rate, so a
  // stream copy is safe and lossless here.
  const silentCut = WANT_AUDIO ? path.join(workDir, 'video-only.mp4') : OUTPUT;
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', silentCut], 'concat');

  // ── Music, mix and mux ────────────────────────────────────────────────────
  let audioReport = null;
  if (WANT_AUDIO) {
    const videoSeconds = durationOf(silentCut) ?? cursor;

    const bed = path.join(workDir, 'bed.wav');
    const music = ambientBed({ ffmpeg: FFMPEG, seconds: videoSeconds + 0.5, out: bed });
    if (!music.ok) {
      console.error(`
background music failed:
${music.error}`);
      process.exit(1);
    }

    const mixed = path.join(workDir, 'mixed.wav');
    const mix = mixNarration({
      ffmpeg: FFMPEG,
      entries: narration,
      bed,
      seconds: videoSeconds,
      out: mixed,
    });
    if (!mix.ok) {
      console.error(`
audio mix failed:
${mix.error}`);
      process.exit(1);
    }

    const levels = loudnessOf({ ffmpeg: FFMPEG, file: mixed });

    // AAC-LC at 44.1kHz stereo in an mp4 with faststart: the combination every
    // standard player handles without a codec pack, which is the whole point of
    // shipping one file.
    ff(
      [
        '-y',
        '-i', silentCut,
        '-i', mixed,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
        '-shortest',
        '-movflags', '+faststart',
        OUTPUT,
      ],
      'mux audio into the mp4',
    );

    // The sync plan is written out beside the video: every line, the second it
    // is spoken, and how long it runs. It is what scripts/verify-video.mjs
    // checks the finished audio against, so "the narration is synchronised" is
    // a testable claim rather than an assurance.
    await writeFile(
      PLAN_FILE,
      JSON.stringify(
        {
          renderedAt: new Date().toISOString(),
          voice: voiceName,
          speechRate: SPEECH_RATE,
          videoSeconds: videoSeconds,
          loudness: levels,
          lines: narration.map((n) => ({
            at: Number(n.at.toFixed(3)),
            seconds: Number(n.speech.toFixed(3)),
            text: n.text,
          })),
        },
        null,
        2,
      ),
      'utf8',
    );

    audioReport = { levels, lines: narration.length };
  }

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

  // Read the streams back off the finished file. "It has audio" is a claim
  // about the artefact, so it is checked against the artefact rather than
  // inferred from ffmpeg having exited zero.
  const streams = streamsOf({ ffmpeg: FFMPEG, file: OUTPUT });
  console.log('\nSTREAMS IN THE FINISHED FILE');
  for (const line of streams.all) console.log(`  ${line}`);
  if (audioReport) {
    console.log(
      `\nAUDIO  ${audioReport.lines} narration lines - voice ${voiceName} - ` +
        `${audioReport.levels.lufs ?? '?'} LUFS integrated - peak ${audioReport.levels.peak ?? '?'} dBFS`,
    );
  }

  const missingVideo = streams.video.length === 0;
  const missingAudio = WANT_AUDIO && streams.audio.length === 0;
  if (missingVideo || missingAudio) {
    console.error(
      `\nFINISHED FILE IS INCOMPLETE:${missingVideo ? ' no video stream' : ''}${missingAudio ? ' no audio stream' : ''}`,
    );
    process.exit(1);
  }

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
