/**
 * On-device speech-to-text, as a swappable adapter.
 *
 * Sits beside adapters/web's Web Speech capture rather than replacing it: one
 * uploads audio to Google and streams partials, the other runs on the machine
 * and does not. The console names which one transcribed, every time.
 */

export {
  DEFAULT_WHISPER_MODEL,
  WhisperCapture,
  isWhisperLoaded,
  loadWhisper,
  loadedWhisperModel,
} from './whisper-capture.js';
export type { WhisperError, WhisperProgress, WhisperResult } from './whisper-capture.js';
export {
  WHISPER_SAMPLE_RATE,
  durationSeconds,
  hasEnoughSignal,
  looksHallucinated,
  resampleTo16k,
  toMono,
} from './resample.js';
