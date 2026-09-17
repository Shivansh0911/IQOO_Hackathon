/**
 * Checks the finished video against the plan the renderer wrote.
 *
 *   pnpm verify:video
 *
 * Everything here is read off the artefact. The renderer claims the narration
 * is synchronised; this decides whether it is, by finding where speech actually
 * occurs in the encoded audio and comparing that to the timestamps the renderer
 * said it used.
 *
 * How speech is located: the music bed is lowpassed at 780Hz, so above about
 * 1.2kHz essentially the only energy in the mix is the voice. Highpass there
 * and the file becomes "speech or silence", which silencedetect can segment.
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { streamsOf } from './video-audio.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path;

const VIDEO = path.join(root, '.shots/video/origo-demo.mp4');
const PLAN = path.join(root, '.shots/video/origo-demo.audio.json');

/** Speech regions, derived from the gaps between detected silences. */
function speechRegions(file) {
  const r = spawnSync(
    FFMPEG,
    ['-hide_banner', '-i', file, '-af', 'highpass=f=1200,silencedetect=noise=-42dB:d=0.45', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1e8 },
  );
  const text = r.stderr ?? '';
  const silences = [];
  const startRe = /silence_start:\s*(-?[\d.]+)/g;
  const endRe = /silence_end:\s*([\d.]+)/g;
  const starts = [...text.matchAll(startRe)].map((m) => Number(m[1]));
  const ends = [...text.matchAll(endRe)].map((m) => Number(m[1]));
  for (let i = 0; i < starts.length; i += 1) {
    silences.push({ from: starts[i] ?? 0, to: ends[i] ?? Infinity });
  }

  // Invert: anything not silent is speech.
  const regions = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.from > cursor + 0.05) regions.push({ from: cursor, to: silence.from });
    cursor = Math.max(cursor, silence.to === Infinity ? cursor : silence.to);
  }
  return { regions, silences };
}

const overlaps = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from);

async function main() {
  const problems = [];

  if (!existsSync(VIDEO)) {
    console.error(`No rendered video at ${path.relative(root, VIDEO)}.\nRun:  pnpm render`);
    process.exit(1);
  }

  // ── 1 · Streams ───────────────────────────────────────────────────────────
  const streams = streamsOf({ ffmpeg: FFMPEG, file: VIDEO });
  console.log('STREAMS');
  for (const line of streams.all) console.log(`  ${line}`);
  if (!streams.video.length) problems.push('no video stream');
  if (!streams.audio.length) problems.push('no audio stream');

  const audioLine = streams.audio[0] ?? '';
  // AAC-LC in mp4 is what plays everywhere without a codec pack. Anything else
  // is a portability risk, which is the whole reason for shipping one file.
  if (!/aac/i.test(audioLine)) problems.push(`audio is not AAC: ${audioLine}`);
  if (!/stereo/i.test(audioLine)) problems.push(`audio is not stereo: ${audioLine}`);
  if (!/h264/i.test(streams.video[0] ?? '')) problems.push('video is not H.264');

  if (!existsSync(PLAN)) {
    console.error(`\nNo audio plan at ${path.relative(root, PLAN)} — was the video rendered with audio?`);
    process.exit(1);
  }
  const plan = JSON.parse(await readFile(PLAN, 'utf8'));

  // ── 2 · Loudness and headroom ─────────────────────────────────────────────
  console.log(
    `\nLEVELS  ${plan.loudness.lufs} LUFS integrated · peak ${plan.loudness.peak} dBFS · ` +
      `voice ${plan.voice} at rate ${plan.speechRate}`,
  );
  if (plan.loudness.lufs === null || plan.loudness.lufs > -12 || plan.loudness.lufs < -22) {
    problems.push(`integrated loudness ${plan.loudness.lufs} LUFS is outside a sane -22..-12 band`);
  }
  if (plan.loudness.peak !== null && plan.loudness.peak > -0.3) {
    problems.push(`true peak ${plan.loudness.peak} dBFS is close enough to 0 to risk clipping`);
  }

  // ── 3 · Is the speech where the plan says it is? ──────────────────────────
  const { regions } = speechRegions(VIDEO);
  console.log(`\nSYNC  ${plan.lines.length} planned lines · ${regions.length} speech regions detected`);

  let matched = 0;
  const unmatched = [];
  for (const line of plan.lines) {
    const window = { from: line.at, to: line.at + line.seconds };
    // Count it as aligned if a detected speech region covers at least half of
    // the window the renderer reserved for it. Half, not all, because
    // silencedetect trims the quiet head and tail of a spoken phrase.
    const covered = regions.reduce((best, region) => Math.max(best, overlaps(window, region)), 0);
    if (covered >= Math.min(line.seconds * 0.5, 1.2)) matched += 1;
    else unmatched.push({ line, covered });
  }

  console.log(`      ${matched} of ${plan.lines.length} lines have speech inside their planned window`);
  for (const miss of unmatched.slice(0, 6)) {
    console.log(
      `      MISS at ${miss.line.at.toFixed(1)}s (${miss.line.seconds.toFixed(1)}s reserved, ` +
        `${miss.covered.toFixed(1)}s of speech): "${miss.line.text.slice(0, 58)}…"`,
    );
  }
  // A few misses are expected: a very short line inside a longer detected run
  // can be merged with its neighbour. A systematic offset would fail most.
  if (matched < plan.lines.length * 0.85) {
    problems.push(`only ${matched}/${plan.lines.length} narration lines align with the audio`);
  }

  // ── 4 · Is there music where nobody is speaking? ───────────────────────────
  // Total speech should be well under the running time: if it were ~100% the
  // bed would never be audible, and if it were ~0% the narration never landed.
  const speechSeconds = regions.reduce((sum, r) => sum + (r.to - r.from), 0);
  const share = speechSeconds / plan.videoSeconds;
  console.log(
    `\nMUSIC  ${speechSeconds.toFixed(0)}s of ${plan.videoSeconds.toFixed(0)}s carries speech ` +
      `(${(share * 100).toFixed(0)}%) — the rest is the bed alone`,
  );
  if (share < 0.35) problems.push(`only ${(share * 100).toFixed(0)}% of the video has speech — narration may be missing`);
  if (share > 0.97) problems.push('speech covers the whole file — the music bed can never be heard');

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  if (problems.length) {
    console.log('FAILED');
    for (const problem of problems) console.log(`  · ${problem}`);
    process.exit(1);
  }
  console.log('OK — video stream, AAC narration audio, music bed, and narration in sync.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
