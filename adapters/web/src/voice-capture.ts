/**
 * Voice capture — the web-specific half.
 *
 * Web Speech API for recognition, Web Audio for the energy gate. The DECISIONS
 * all live in @origo/core/voice, which is portable; this file only captures.
 * On Android this becomes SpeechRecognizer with EXTRA_PREFER_OFFLINE and an
 * AudioRecord for amplitude, and the five defences above it do not change.
 *
 * Every failure is a Result. A microphone that is denied, absent, or simply
 * silent is a normal condition of a demo on a borrowed laptop, not an exception.
 */

import type { GateInput, Result, VoiceLocale } from '@origo/core';
import { RMS_FLOOR, describeThrown, err, ok } from '@origo/core';

export interface CaptureError {
  readonly kind: 'unsupported' | 'permission-denied' | 'no-speech' | 'aborted' | 'platform-error';
  readonly message: string;
}

export interface LiveState {
  /** 0..1, for the amplitude meter. */
  readonly level: number;
  /** What recognition has heard so far. Interim and unstable, by design. */
  readonly partial: string;
}

export interface CaptureOptions {
  readonly locale: VoiceLocale;
  readonly onLive?: (state: LiveState) => void;
}

/** The two vendor spellings, and nothing else. */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: { 0: { transcript: string; confidence: number }; isFinal: boolean; length: number };
  };
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceSupported(): boolean {
  return recognitionCtor() !== null && typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function';
}

/**
 * One press-and-hold capture.
 *
 * Returns everything the gates need: the transcript, the confidence recognition
 * reported, and the audio measurements recognition does NOT report — peak RMS
 * and how long the user was actually voicing. Those two are the energy gate, and
 * they are the reason this measures its own audio rather than trusting the
 * speech API's word for it.
 */
export class VoiceCapture {
  private recognition: SpeechRecognitionLike | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private raf = 0;

  private peakRms = 0;
  private voicedMs = 0;
  private partial = '';
  private finalTranscript = '';
  private confidence = 0;

  /** Starts listening. Resolves once the mic is live, not when speech ends. */
  async start(options: CaptureOptions): Promise<Result<true, CaptureError>> {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      return err({
        kind: 'unsupported',
        message: 'This browser has no Web Speech API. Chrome or Edge support it; Firefox does not. You can still type the goal.',
      });
    }

    this.peakRms = 0;
    this.voicedMs = 0;
    this.partial = '';
    this.finalTranscript = '';
    this.confidence = 0;

    try {
      this.stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const name = (cause as { name?: string }).name ?? '';
      return err(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? {
              kind: 'permission-denied',
              message: 'Microphone access was denied. Type the goal instead, or allow the mic in the address bar and try again.',
            }
          : { kind: 'platform-error', message: `Could not open the microphone: ${describeThrown(cause)}` },
      );
    }

    // Our own amplitude measurement. Recognition will not tell us whether the
    // user actually spoke, and that is exactly the gap a hallucinated
    // transcript falls through.
    try {
      const AudioCtx = (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext;
      this.context = new AudioCtx();
      const source = this.context.createMediaStreamSource(this.stream);
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      let last = performance.now();
      const sample = (): void => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) sum += value * value;
        const rms = Math.sqrt(sum / buffer.length);
        const now = performance.now();
        if (rms >= RMS_FLOOR) this.voicedMs += now - last;
        last = now;
        this.peakRms = Math.max(this.peakRms, rms);
        options.onLive?.({ level: Math.min(1, rms * 12), partial: this.partial });
        this.raf = globalThis.requestAnimationFrame(sample);
      };
      this.raf = globalThis.requestAnimationFrame(sample);
    } catch (cause) {
      // Losing the meter costs the energy gate, so we stop rather than run
      // without a defence we claim to have.
      await this.teardown();
      return err({ kind: 'platform-error', message: `Could not measure audio: ${describeThrown(cause)}` });
    }

    const recognition = new Ctor();
    // PINNED, never auto-detected (defence 2).
    recognition.lang = options.locale;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event): void => {
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const alternative = result[0];
        if (result.isFinal) {
          this.finalTranscript += alternative.transcript;
          this.confidence = Math.max(this.confidence, alternative.confidence);
        } else {
          interim += alternative.transcript;
        }
      }
      this.partial = (this.finalTranscript + interim).trim();
      options.onLive?.({ level: Math.min(1, this.peakRms * 12), partial: this.partial });
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (cause) {
      await this.teardown();
      return err({ kind: 'platform-error', message: `Recognition would not start: ${describeThrown(cause)}` });
    }
    return ok(true);
  }

  /** Stops listening and returns what the gates need to judge it. */
  async stop(locale: VoiceLocale): Promise<Result<GateInput, CaptureError>> {
    const recognition = this.recognition;
    if (!recognition) {
      return err({ kind: 'aborted', message: 'The microphone was not running.' });
    }

    // Wait for recognition to flush its final result, but never forever: a
    // stuck recogniser must not leave the UI listening with no way out.
    const settled = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1500);
      recognition.onend = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      try {
        recognition.stop();
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
    void settled;

    const measured: GateInput = {
      transcript: this.finalTranscript.trim() || this.partial,
      confidence: this.confidence,
      peakRms: this.peakRms,
      voicedMs: this.voicedMs,
      locale,
    };
    await this.teardown();
    return ok(measured);
  }

  async cancel(): Promise<void> {
    try {
      this.recognition?.abort();
    } catch {
      // Aborting an already-dead recogniser is not a problem worth reporting.
    }
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    if (this.raf) globalThis.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.recognition = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    try {
      await this.context?.close();
    } catch {
      // A context that is already closed is the state we wanted.
    }
    this.context = null;
  }
}
