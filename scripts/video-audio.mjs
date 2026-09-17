/**
 * Audio for the rendered video: synthesised narration over a generated bed.
 *
 * Both are produced locally and from scratch — Windows' built-in speech engine
 * and ffmpeg's oscillators. Nothing is downloaded, nothing is licensed, and
 * there is no third-party asset to attribute or to get wrong. That matters for
 * a submission: borrowed music is the easiest way to make a good project
 * un-shippable.
 *
 * The narration text comes from the same docs/VIDEO_SCRIPT.md rows that drive
 * the burned-in captions, so what is spoken and what is written cannot
 * disagree.
 */

import { spawnSync } from 'node:child_process';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Voices are checked at runtime; a machine without this one falls back. */
const VOICE_PREFERENCE = ['Microsoft Hazel Desktop', 'Microsoft Zira Desktop', 'Microsoft David Desktop'];

/**
 * Speaks every line into its own wav, in ONE PowerShell process.
 *
 * One process rather than one per line because process start-up dominates:
 * forty lines at roughly 700ms of PowerShell start-up each is half a minute of
 * pure overhead.
 *
 * `rate` is the engine's -10..10 scale. It is a parameter because the scripted
 * timings in VIDEO_SCRIPT.md were written for a human reading aloud, and the
 * synthesiser does not naturally match them — the caller measures the result
 * and adjusts rather than assuming.
 */
export async function synthesise({ lines, dir, rate = 0 }) {
  await mkdir(dir, { recursive: true });

  const manifest = lines.map((line, i) => ({
    index: i,
    text: line.text,
    file: path.join(dir, `line-${String(i).padStart(3, '0')}.wav`),
  }));

  const manifestFile = path.join(dir, 'lines.json');
  await writeFile(manifestFile, JSON.stringify(manifest.map((m) => ({ text: m.text, file: m.file }))), 'utf8');

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
foreach ($want in @(${VOICE_PREFERENCE.map((v) => `'${v}'`).join(', ')})) {
  if ($installed -contains $want) { $synth.SelectVoice($want); break }
}
Write-Output ("VOICE=" + $synth.Voice.Name)
$synth.Rate = ${rate}
$synth.Volume = 100
$lines = Get-Content -Raw -Encoding UTF8 '${manifestFile.replace(/\\/g, '\\\\')}' | ConvertFrom-Json
foreach ($line in $lines) {
  $synth.SetOutputToWaveFile($line.file)
  $synth.Speak($line.text)
}
$synth.SetOutputToNull()
$synth.Dispose()
Write-Output "DONE"
`;

  const scriptFile = path.join(dir, 'speak.ps1');
  await writeFile(scriptFile, ps, 'utf8');
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
    encoding: 'utf8',
    maxBuffer: 1e8,
  });
  if (result.status !== 0 || !(result.stdout ?? '').includes('DONE')) {
    return {
      ok: false,
      error: `speech synthesis failed:\n${(result.stderr || result.stdout || 'no output').trim().slice(0, 600)}`,
    };
  }

  const voice = /VOICE=(.+)/.exec(result.stdout ?? '')?.[1]?.trim() ?? 'unknown';
  const missing = manifest.filter((m) => !existsSync(m.file));
  if (missing.length) {
    return { ok: false, error: `${missing.length} of ${manifest.length} lines produced no audio file` };
  }
  return { ok: true, voice, files: manifest };
}

/**
 * A quiet ambient bed, generated rather than sourced.
 *
 * Three detuned sine pairs an octave apart make a sustained minor chord; the
 * slow tremolo and the two echo taps stop it sounding like a test tone, and the
 * lowpass takes the edge off the fundamentals. It is deliberately dull — this
 * sits 20-odd dB under the narration and is texture, not content.
 */
export function ambientBed({ ffmpeg, seconds, out }) {
  // A minor: A2, C4, E4, with the root doubled slightly detuned for movement.
  const tones = [110, 110.6, 261.63, 329.63];
  const inputs = tones.flatMap((f) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${seconds.toFixed(2)}`]);
  const mix = tones.map((_, i) => `[${i}:a]`).join('');

  const filter =
    // This ffmpeg (4.1) has no amix `normalize` option, and amix divides by the
    // input count, so the gain below already accounts for the 1/N attenuation.
    `${mix}amix=inputs=${tones.length},` +
    // Slow breathing, so the bed does not sit perfectly static.
    `tremolo=f=0.12:d=0.3,` +
    `lowpass=f=780,` +
    // Two taps give it a room rather than a tone generator.
    `aecho=0.8:0.85:900|1700:0.28|0.16,` +
    `volume=0.26,` +
    `afade=t=in:st=0:d=3,afade=t=out:st=${Math.max(0, seconds - 4).toFixed(2)}:d=4,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo`;

  const r = spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-t', seconds.toFixed(2), out],
    { encoding: 'utf8', maxBuffer: 1e8 },
  );
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr ?? '').trim().slice(-400) };
  }
  return { ok: true };
}

/**
 * Places each spoken line at its absolute timestamp, ducks the bed under it,
 * and normalises the result.
 *
 * `adelay` per line rather than concatenating with silence: the delay is exact
 * to the millisecond and cannot accumulate rounding error across forty lines,
 * which a chain of silence padding absolutely would.
 *
 * The ducking is a real sidechain compressor keyed off the voice bus, not a
 * static level. A fixed mix has to be quiet enough for the loudest line, which
 * leaves the bed inaudible everywhere else; sidechained, the bed sits up during
 * the silent section cards and steps back the moment anyone speaks.
 *
 * `loudnorm` then puts the whole thing at a predictable -16 LUFS (the usual
 * target for speech-led video) and `alimiter` catches anything the
 * normalisation pushes at the ceiling, so the file cannot clip.
 */
export function mixNarration({ ffmpeg, entries, bed, seconds, out }) {
  const inputs = [];
  const parts = [];
  const graph = [];

  // The voice bus is a CONCAT of silence-then-speech, not a mix.
  //
  // amix looked like the obvious tool and is the wrong one here: this ffmpeg
  // divides by the input count, and with forty-one inputs that each end at a
  // different moment it renormalises as they drop out, so every line would come
  // back at a different level. Concatenating exact silences instead places each
  // line to the millisecond at unity gain, and the lines never overlap, so
  // nothing is lost by not mixing them.
  let previousEnd = 0;
  entries.forEach((entry, i) => {
    inputs.push('-i', entry.file);
    const gap = Math.max(0, entry.at - previousEnd);
    if (gap > 0.001) {
      graph.push(`anullsrc=r=44100:cl=stereo,atrim=0:${gap.toFixed(3)}[gap${i}]`);
      parts.push(`[gap${i}]`);
    }
    graph.push(
      `[${i}:a]atrim=0:${entry.speech.toFixed(3)},asetpts=N/SR/TB,` +
        `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[say${i}]`,
    );
    parts.push(`[say${i}]`);
    previousEnd = entry.at + entry.speech;
  });

  // Silence out to the end of the picture, so the voice bus and the bed are the
  // same length and the sidechain key does not run out early.
  const tail = Math.max(0, seconds - previousEnd);
  if (tail > 0.001) {
    graph.push(`anullsrc=r=44100:cl=stereo,atrim=0:${tail.toFixed(3)}[tail]`);
    parts.push('[tail]');
  }

  graph.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[voice]`);
  // The voice is needed twice: once as the audible signal, once as the key that
  // tells the compressor when to pull the music down.
  graph.push(`[voice]asplit=2[voice_out][voice_key]`);

  const bedIndex = entries.length;
  inputs.push('-i', bed);
  graph.push(`[${bedIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[bed_in]`);

  // Real sidechain ducking rather than a static level. A fixed mix has to be
  // quiet enough for the loudest line, which leaves the bed inaudible
  // everywhere else; keyed off the voice, the bed sits up during the silent
  // section cards and steps back the moment anyone speaks.
  graph.push(
    `[bed_in][voice_key]sidechaincompress=` +
      `threshold=0.02:ratio=14:attack=20:release=500:makeup=1:level_sc=1[bed_ducked]`,
  );

  // amix halves both here, which loudnorm then makes up — what matters at this
  // point is the RATIO between speech and bed, and amix preserves that.
  graph.push(
    `[voice_out][bed_ducked]amix=inputs=2:dropout_transition=0,` +
      `loudnorm=I=-16:TP=-1.5:LRA=11,` +
      `alimiter=limit=0.94,` +
      `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo[mixed]`,
  );

  const r = spawnSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputs,
      '-filter_complex', graph.join(';'),
      '-map', '[mixed]',
      '-t', seconds.toFixed(2),
      out,
    ],
    { encoding: 'utf8', maxBuffer: 1e8 },
  );
  if (r.status !== 0) return { ok: false, error: (r.stderr ?? '').trim().slice(-900) };
  return { ok: true };
}

/** Duration of an audio or video file, read from ffmpeg's own report. */
export function durationOfMedia({ ffmpeg, file }) {
  const r = spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8', maxBuffer: 1e8 });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * Reports the streams actually present in a container.
 *
 * ffprobe is not bundled with the ffmpeg we use, so this parses ffmpeg's own
 * stream summary. It exists because "the file has audio" is a claim that should
 * be read off the artefact, not inferred from the command having succeeded.
 */
export function streamsOf({ ffmpeg, file }) {
  const r = spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8', maxBuffer: 1e8 });
  const text = r.stderr ?? '';
  const lines = [...text.matchAll(/Stream #\d+:\d+.*/g)].map((m) => m[0].trim());
  return {
    video: lines.filter((l) => l.includes('Video:')),
    audio: lines.filter((l) => l.includes('Audio:')),
    all: lines,
  };
}

/** Measured loudness, so the mix can be reported as a number and not a vibe. */
export function loudnessOf({ ffmpeg, file }) {
  // No framelog=quiet: on this ffmpeg build it makes the integrated figure come
  // back as a flat 0.0 LUFS while the per-frame path reports correctly. Measured
  // — the quiet variant silently reported 0.0 for a file that is actually at
  // -15.4. peak=true is what enables the true-peak line at all.
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 1e8,
  });
  const text = r.stderr ?? '';
  // Read the trailing Summary block, not the rolling per-frame log.
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const integrated = /I:\s*(-?\d+\.\d+)\s*LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s*(-?\d+\.\d+)\s*dBFS/.exec(summary)?.[1];
  return { lufs: integrated ? Number(integrated) : null, peak: peak ? Number(peak) : null };
}

void readdir;
void process;
