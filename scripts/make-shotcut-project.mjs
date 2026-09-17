/**
 * Lays the whole video out as a Shotcut project, ready to open.
 *
 *   pnpm assemble
 *
 * Output: .shots/video/origo-demo.mlt — open it in Shotcut and the five clips
 * are already on the timeline, in script order, trimmed, with a blank slot in
 * each of the three places a human supplies footage (opener, architecture
 * slide, close) and an empty audio track waiting for the voiceover.
 *
 * Why a project file and not a rendered mp4: the video needs a voiceover and
 * two pieces of human footage regardless, so it has to be opened in an editor
 * either way. Generating the project means the editing session starts with
 * every cut point already correct, instead of placing five clips against a
 * table of timecodes at midnight.
 *
 * No encoding happens here — this is XML pointing at clips that already exist.
 * ffmpeg is used only to READ each clip's true duration, so the timeline is
 * built from measured lengths rather than from the numbers in the script.
 */

import { writeFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const videoDir = path.join(root, '.shots/video');

/**
 * The timeline, matching the section boundaries in docs/VIDEO_SCRIPT.md.
 *
 * `hold` extends a clip past its source end. Shotcut renders that as a freeze
 * on the final frame, which is how a 23-second clip carries a 29-second
 * narration without speeding the footage up or padding it with filler.
 *
 * clip-04-fail is deliberately not here: the script has no slot for it (see the
 * deviation note in VIDEO_SCRIPT.md). It stays recorded as a spare, for the
 * live demo or a judge's question.
 */
const TIMELINE = [
  { gap: 18, note: 'YOU, TO CAMERA — 0:00 THE PROBLEM, six lines' },
  { clip: 'clip-02-tokens', hold: 6, note: 'THE INSIGHT — 438 tokens, measured' },
  { clip: 'clip-01-goal', hold: 3, note: 'IT WORKS — narrate the decisions, not the UI' },
  { clip: 'clip-03-guardrail', hold: 0, note: 'IT IS SAFE — the destructive gate' },
  { clip: 'clip-05-rejects', hold: 12, note: 'IT IS SAFE — 15 rejections in 20 calls. GIVE THIS ITS TIME.' },
  { gap: 32, note: 'YOUR ARCHITECTURE SLIDE — IT PORTS, seven lines' },
  { gap: 30, note: 'YOU, TO CAMERA — WHO AND WHAT IS OPEN. Do not cut the last two lines.' },
];

/** Playwright bundles an ffmpeg; it decodes webm, which is all we need it for. */
function findFfmpeg() {
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(base)) return null;
  const found = [];
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('ffmpeg')) continue;
    for (const name of ['ffmpeg-win64.exe', 'ffmpeg.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
      const full = path.join(base, entry, name);
      if (existsSync(full)) found.push(full);
    }
  }
  return found.sort().at(-1) ?? null;
}

const FFMPEG = findFfmpeg();

/** Duration in seconds, read out of the file rather than assumed. */
function durationOf(file) {
  if (!FFMPEG) return null;
  const stderr = spawnSync(FFMPEG, ['-i', file], { encoding: 'utf8' }).stderr ?? '';
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** MLT timecodes are HH:MM:SS.mmm */
function tc(seconds) {
  const whole = Math.max(0, seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

const clock = (seconds) => tc(seconds).slice(3, 8);
const esc = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function main() {
  if (!FFMPEG) {
    console.error('No ffmpeg found to read clip durations. Playwright normally bundles one:');
    console.error('  npx playwright install chromium');
    process.exit(1);
  }

  const producers = [];
  const entries = [];
  let at = 0;
  let index = 0;

  console.log('\nTIMELINE');
  console.log('-'.repeat(96));

  for (const item of TIMELINE) {
    if (item.gap !== undefined) {
      entries.push(`      <blank length="${tc(item.gap)}"/>`);
      console.log(
        `${clock(at)} → ${clock(at + item.gap)}   ${`[blank ${item.gap}s]`.padEnd(22)}         ${item.note}`,
      );
      at += item.gap;
      continue;
    }

    const file = path.join(videoDir, item.clip, `${item.clip}.webm`);
    if (!existsSync(file)) {
      console.error(`\nMissing clip: ${path.relative(root, file)}`);
      console.error('Record them first:  pnpm record');
      process.exit(1);
    }
    const real = durationOf(file);
    if (real === null) {
      console.error(`\nCould not read the duration of ${item.clip}. Re-record it:  pnpm record`);
      process.exit(1);
    }

    // Trim the first 0.6s (the page-load flash) and the last 0.1s, then hold.
    const inPoint = 0.6;
    const outPoint = real - 0.1 + item.hold;
    const id = `producer${index}`;

    producers.push(
      [
        `  <producer id="${id}" in="00:00:00.000" out="${tc(outPoint)}">`,
        `    <property name="resource">${esc(file)}</property>`,
        `    <property name="mlt_service">avformat-novalidate</property>`,
        `    <property name="video_index">0</property>`,
        `    <property name="audio_index">-1</property>`,
        `    <property name="shotcut:caption">${esc(item.clip)}</property>`,
        `  </producer>`,
      ].join('\n'),
    );
    entries.push(`      <entry producer="${id}" in="${tc(inPoint)}" out="${tc(outPoint)}"/>`);

    const length = outPoint - inPoint;
    const held = item.hold > 0 ? `+${item.hold}s freeze` : '';
    console.log(
      `${clock(at)} → ${clock(at + length)}   ${item.clip.padEnd(22)} ${length.toFixed(1).padStart(5)}s ${held.padEnd(11)} ${item.note}`,
    );
    at += length;
    index += 1;
  }

  console.log('-'.repeat(96));
  console.log(`TOTAL ${clock(at)}   (target 3:00)\n`);

  const mlt = [
    `<?xml version="1.0" standalone="no"?>`,
    `<mlt LC_NUMERIC="C" version="7.0.0" title="Origo Loop — demo" producer="tractor0">`,
    `  <profile description="HD 1080p 25 fps" width="1920" height="1080" progressive="1"`,
    `    sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="16" display_aspect_den="9"`,
    `    frame_rate_num="25" frame_rate_den="1" colorspace="709"/>`,
    ...producers,
    `  <playlist id="background">`,
    `    <entry producer="black" in="00:00:00.000" out="${tc(at)}"/>`,
    `  </playlist>`,
    `  <producer id="black">`,
    `    <property name="resource">0</property>`,
    `    <property name="mlt_service">color</property>`,
    `    <property name="length">${tc(at)}</property>`,
    `  </producer>`,
    `  <playlist id="playlist0">`,
    `    <property name="shotcut:video">1</property>`,
    `    <property name="shotcut:name">Screen recordings</property>`,
    ...entries,
    `  </playlist>`,
    `  <playlist id="playlist1">`,
    `    <property name="shotcut:audio">1</property>`,
    `    <property name="shotcut:name">Voiceover — drop your recording here</property>`,
    `  </playlist>`,
    `  <tractor id="tractor0" title="Origo Loop — demo" in="00:00:00.000" out="${tc(at)}">`,
    `    <property name="shotcut">1</property>`,
    `    <track producer="background"/>`,
    `    <track producer="playlist0"/>`,
    `    <track producer="playlist1" hide="video"/>`,
    `  </tractor>`,
    `</mlt>`,
  ].join('\n');

  const out = path.join(videoDir, 'origo-demo.mlt');
  await writeFile(out, mlt, 'utf8');

  console.log(`  ${path.relative(root, out)}  (${(await stat(out)).size} bytes)\n`);
  console.log('Open that file in Shotcut. Already done for you:');
  console.log('  · five clips, trimmed, in script order, with the freezes applied');
  console.log('  · a blank slot at each point you supply footage');
  console.log('  · an empty audio track named for the voiceover');
  console.log('\nThen: record the voiceover onto track 2, drop your three pieces of');
  console.log('footage into the blanks, File → Export → YouTube.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
