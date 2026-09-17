/**
 * On-device speech-to-text. The audio never leaves the machine.
 *
 * WHY THIS EXISTS, measured rather than assumed. The Web Speech API is not
 * on-device: Chrome uploads the audio to a Google service. On the network this
 * was built on that service does not answer — recognition fires `start` and
 * `audiostart`, then ends with no transcript and no error code, identically in
 * Chromium and in real Chrome, with and without our level meter (see D18). So
 * the microphone was unusable and nothing in our code could fix it.
 *
 * It also made the prototype unfaithful in the one place that matters. The
 * Android build transcribes on the handset with SpeechRecognizer and
 * EXTRA_PREFER_OFFLINE. A web replica that ships the screen's audio to Google
 * is the least representative part of the whole demo. Whisper in the browser is
 * both the fix and the closer analogue.
 *
 * WHAT IT COSTS, stated up front: a ~40MB model downloaded once and then
 * cached, and a few seconds of compute per utterance rather than streaming
 * partials. It is slower than the cloud and it is honest about being slower.
 *
 * WHAT IT DOES NOT PROVIDE: a confidence score. Whisper does not report one,
 * so `confidence` comes back 0 — which the core's gate already treats as "not
 * reported" and skips. That is a real reduction in defences and the UI says so
 * rather than leaving it implied. The energy, filler and surprise-script gates
 * all still run, and the transcript is still only ever a proposal.
 */

import type { Result } from '@origo/core';
import { RMS_FLOOR, describeThrown, err, ok } from '@origo/core';
import {
  WHISPER_SAMPLE_RATE,
  durationSeconds,
  hasEnoughSignal,
  looksHallucinated,
  resampleTo16k,
  toMono,
} from './resample.js';

/** Multilingual tiny: the smallest Whisper that handles Hindi and Hinglish. */
export const DEFAULT_WHISPER_MODEL = 'Xenova/whisper-tiny';

export interface WhisperError {
  readonly kind: 'unsupported' | 'permission-denied' | 'not-loaded' | 'no-speech' | 'platform-error';
  readonly message: string;
}

export interface WhisperProgress {
  /** 0..1 where known; the loader reports per-file progress. */
  readonly progress: number;
  readonly text: string;
}

export interface WhisperResult {
  readonly transcript: string;
  /** Always 0: Whisper reports no confidence. Named, not hidden. */
  readonly confidence: 0;
  readonly peakRms: number;
  readonly voicedMs: number;
  readonly seconds: number;
  readonly transcribeMs: number;
}

type TranscribeFn = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;

/**
 * Loads the model once per page and keeps it. The engine is deliberately a
 * module-level singleton: two copies of a 40MB model in one tab is an
 * out-of-memory crash, and the browser cache makes the second *page* load
 * cheap anyway.
 */
let pipelinePromise: Promise<TranscribeFn> | null = null;
let loadedModel: string | null = null;

/** Whether the model is in memory and ready to transcribe right now. */
export function isWhisperLoaded(): boolean {
  return loadedModel !== null;
}

/** The model actually loaded, for the status readout. Never hardcoded in UI. */
export function loadedWhisperModel(): string | null {
  return loadedModel;
}

export async function loadWhisper(
  model: string = DEFAULT_WHISPER_MODEL,
  onProgress?: (progress: WhisperProgress) => void,
): Promise<Result<true, WhisperError>> {
  if (loadedModel === model && pipelinePromise) return ok(true);

  try {
    pipelinePromise ??= (async (): Promise<TranscribeFn> => {
      // Dynamic import so the library and its wasm are not in the first paint.
      const transformers = await import('@xenova/transformers');
      // Browser-only: never look for a local model directory on a web host.
      transformers.env.allowLocalModels = false;
      const pipe = await transformers.pipeline('automatic-speech-recognition', model, {
        quantized: true,
        progress_callback: (report: { status?: string; progress?: number; file?: string }) => {
          onProgress?.({
            progress: typeof report.progress === 'number' ? report.progress / 100 : 0,
            text: `${report.status ?? 'loading'} ${report.file ?? ''}`.trim(),
          });
        },
      });
      return pipe as unknown as TranscribeFn;
    })();

    await pipelinePromise;
    loadedModel = model;
    return ok(true);
  } catch (cause) {
    // Reset so a retry can actually retry rather than awaiting a dead promise.
    pipelinePromise = null;
    loadedModel = null;
    return err({
      kind: 'platform-error',
      message: `The on-device speech model would not load: ${describeThrown(cause)}. The network is needed once to fetch it; after that it is cached.`,
    });
  }
}

/**
 * Records while held, then transcribes on release.
 *
 * Deliberately NOT streaming. Whisper is a sequence model over a whole window;
 * feeding it partial audio repeatedly costs many times the compute for a
 * partial answer nobody acts on, because the transcript is a proposal that a
 * human confirms anyway.
 */
export class WhisperCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private peakRms = 0;
  private voicedMs = 0;
  private sampleRate = WHISPER_SAMPLE_RATE;

  /** Opens the microphone and starts buffering. */
  async start(options: { onLive?: (state: { level: number }) => void } = {}): Promise<Result<true, WhisperError>> {
    if (!isWhisperLoaded()) {
      return err({
        kind: 'not-loaded',
        message: 'The on-device speech model is not loaded yet. Press "Load voice model" first — about 40MB, once.',
      });
    }

    this.chunks = [];
    this.peakRms = 0;
    this.voicedMs = 0;

    try {
      this.stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const name = (cause as { name?: string }).name ?? '';
      return err(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? {
              kind: 'permission-denied',
              message: 'Microphone access was denied. Allow it in the address bar, or type the goal instead.',
            }
          : { kind: 'platform-error', message: `Could not open the microphone: ${describeThrown(cause)}` },
      );
    }

    try {
      const AudioCtx = (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext;
      this.context = new AudioCtx();
      this.sampleRate = this.context.sampleRate;
      const source = this.context.createMediaStreamSource(this.stream);

      // ScriptProcessor is deprecated and is still the only way to get raw
      // PCM without shipping a separate AudioWorklet file, which a static host
      // makes awkward. The buffer is 4096 frames: large enough that the main
      // thread is not woken constantly, small enough that the level meter
      // still looks live.
      const processor = this.context.createScriptProcessor(4096, 1, 1);
      let last = performance.now();
      processor.onaudioprocess = (event): void => {
        const input = event.inputBuffer;
        const channels: Float32Array[] = [];
        for (let c = 0; c < input.numberOfChannels; c += 1) channels.push(new Float32Array(input.getChannelData(c)));
        const mono = toMono(channels);
        this.chunks.push(mono);

        let sum = 0;
        for (const sample of mono) sum += sample * sample;
        const rms = Math.sqrt(sum / Math.max(1, mono.length));
        const now = performance.now();
        if (rms >= RMS_FLOOR) this.voicedMs += now - last;
        last = now;
        this.peakRms = Math.max(this.peakRms, rms);
        options.onLive?.({ level: Math.min(1, rms * 12) });
      };
      source.connect(processor);
      // A ScriptProcessor only runs when connected to a destination. Routing it
      // through a silent gain node stops the microphone being played back
      // through the speakers, which is otherwise an immediate feedback loop.
      const mute = this.context.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(this.context.destination);
      this.processor = processor;
    } catch (cause) {
      await this.teardown();
      return err({ kind: 'platform-error', message: `Could not capture audio: ${describeThrown(cause)}` });
    }

    return ok(true);
  }

  /** Stops recording and transcribes what was captured. */
  async stop(locale: string): Promise<Result<WhisperResult, WhisperError>> {
    const rate = this.sampleRate;
    const captured = this.chunks;
    const peakRms = this.peakRms;
    const voicedMs = this.voicedMs;
    await this.teardown();

    let total = 0;
    for (const chunk of captured) total += chunk.length;
    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of captured) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }

    const audio = resampleTo16k(joined, rate);
    const seconds = durationSeconds(audio);

    // Refuse before the model rather than after: Whisper invents speech when
    // given silence, and an invented instruction is exactly what this project
    // is built to never execute.
    if (!hasEnoughSignal(audio, RMS_FLOOR)) {
      return err({
        kind: 'no-speech',
        message: 'Nothing loud enough to transcribe. Hold the button, speak, then release.',
      });
    }

    const pipe = await pipelinePromise;
    if (!pipe) {
      return err({ kind: 'not-loaded', message: 'The on-device speech model is no longer loaded. Load it again.' });
    }

    const started = performance.now();
    let text = '';
    try {
      const output = await pipe(audio, {
        // Whisper's own language codes, from the locale the user pinned.
        language: locale.startsWith('hi') ? 'hindi' : 'english',
        task: 'transcribe',
        // No timestamps: we want one string, and asking for chunks costs time.
        return_timestamps: false,
      });
      text = (output.text ?? '').trim();
    } catch (cause) {
      return err({ kind: 'platform-error', message: `On-device transcription failed: ${describeThrown(cause)}` });
    }
    const transcribeMs = performance.now() - started;

    if (looksHallucinated(text)) {
      return err({
        kind: 'no-speech',
        message: `The model returned "${text}", which is what Whisper produces for silence rather than something you said. Try again, a little louder.`,
      });
    }

    return ok({ transcript: text, confidence: 0, peakRms, voicedMs, seconds, transcribeMs });
  }

  async cancel(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.processor = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    try {
      await this.context?.close();
    } catch {
      // Already closed is the state we wanted.
    }
    this.context = null;
    this.chunks = [];
  }
}
