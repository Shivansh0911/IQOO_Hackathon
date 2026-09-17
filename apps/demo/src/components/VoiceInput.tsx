/**
 * The mic, and the review step.
 *
 * THE TRANSCRIPT IS A PROPOSAL, NEVER A COMMAND. There is no path from this
 * component to a run that does not pass through a human pressing "Use this
 * goal". Not in demo mode, not with a perfect confidence score, not ever.
 *
 * Every substitution the lexicon made is shown as a revertible diff —
 * struck-through original, amber replacement — because silently rewriting what
 * somebody said is how you lose their trust in one step.
 */

import { useCallback, useRef, useState } from 'react';
import {
  applyGates,
  applyLexicon,
  buildLexicon,
  correctionsFor,
  diffCorrections,
  hasSurpriseScript,
  mergeCorrections,
  VOICE_LOCALES,
} from '@origo/core';
import type { CorrectionEntry, GateInput, GateVerdict, Substitution, VoiceLocale } from '@origo/core';
import { VoiceCapture, isVoiceSupported } from '@origo/adapter-web';
import {
  DEFAULT_WHISPER_MODEL,
  WhisperCapture,
  isWhisperLoaded,
  loadWhisper,
  loadedWhisperModel,
} from '@origo/adapter-whisper';

const CORRECTIONS_KEY = 'origo.voice.corrections';
const LOCALE_KEY = 'origo.voice.locale';

function loadCorrections(): CorrectionEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(CORRECTIONS_KEY);
    return raw ? (JSON.parse(raw) as CorrectionEntry[]) : [];
  } catch {
    return [];
  }
}

function saveCorrections(entries: readonly CorrectionEntry[]): void {
  try {
    globalThis.localStorage?.setItem(CORRECTIONS_KEY, JSON.stringify(entries));
  } catch {
    // A full or blocked store costs the learning, not the run.
  }
}

function loadLocale(): VoiceLocale {
  try {
    const raw = globalThis.localStorage?.getItem(LOCALE_KEY);
    if (raw === 'en-IN' || raw === 'hi-IN' || raw === 'en-US') return raw;
  } catch {
    // Fall through to the default.
  }
  return 'en-IN';
}

interface Proposal {
  /** Exactly what recognition returned, before any substitution. */
  readonly heard: string;
  /** What the lexicon and corrections propose instead. Editable. */
  readonly proposed: string;
  readonly substitutions: readonly Substitution[];
  readonly surpriseScript: boolean;
  readonly confidence: number;
}

export function VoiceInput({
  disabled,
  screenTexts,
  onConfirm,
}: {
  disabled: boolean;
  /** Visible text from the current screen, for the proper-noun lexicon. */
  screenTexts: readonly string[];
  onConfirm: (goal: string) => void;
}) {
  const capture = useRef<VoiceCapture | null>(null);
  const [locale, setLocale] = useState<VoiceLocale>(loadLocale);
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState<{ level: number; partial: string }>({ level: 0, partial: '' });
  const [rejected, setRejected] = useState<GateVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [edited, setEdited] = useState('');
  const [corrections, setCorrections] = useState<CorrectionEntry[]>(loadCorrections);
  const [showTable, setShowTable] = useState(false);

  const supported = isVoiceSupported();

  /**
   * The on-device engine, loaded on request.
   *
   * Two engines, and the difference is not cosmetic: the browser's Web Speech
   * API uploads the audio to Google, and Whisper here does not. On the network
   * this was built on the Google service does not answer at all — recognition
   * ends with no transcript and no error — so on-device is also the only one
   * that works (D18). Whichever ran is named on screen afterwards.
   */
  const whisper = useRef<WhisperCapture | null>(null);
  const [whisperReady, setWhisperReady] = useState(isWhisperLoaded);
  const [whisperLoad, setWhisperLoad] = useState<{ progress: number; text: string } | null>(null);
  const [lastEngine, setLastEngine] = useState<string | null>(null);

  const loadVoiceModel = useCallback(async () => {
    setError(null);
    setWhisperLoad({ progress: 0, text: 'starting' });
    const result = await loadWhisper(DEFAULT_WHISPER_MODEL, (report) => setWhisperLoad(report));
    if (!result.ok) {
      setError(result.error.message);
      setWhisperLoad(null);
      return;
    }
    setWhisperLoad(null);
    setWhisperReady(true);
  }, []);

  /**
   * The five defences, applied identically whichever engine transcribed.
   *
   * Extracted deliberately. With two capture paths it would be very easy for
   * one of them to skip a gate, and the gates are the entire reason a spoken
   * goal is safe to act on. There is exactly one route from audio to a
   * proposal, and both engines take it.
   */
  const accept = useCallback(
    async (measured: GateInput) => {
      // Defence 1: the gates. A discarded transcript can never start a run.
      const verdict = applyGates(measured);
      if (!verdict.accepted) {
        setRejected(verdict);
        return;
      }

      // Defence 4 and 5: learned corrections first, then the on-screen lexicon.
      const lexicon = buildLexicon(screenTexts, ['Tiffin']);
      const matched = applyLexicon(measured.transcript, lexicon, correctionsFor(corrections, locale));

      setProposal({
        heard: measured.transcript,
        proposed: matched.text,
        substitutions: matched.substitutions,
        // Defence 2: a script the pinned locale should not produce.
        surpriseScript: hasSurpriseScript(measured.transcript, locale),
        confidence: measured.confidence,
      });
      setEdited(matched.text);
    },
    [corrections, locale, screenTexts],
  );

  const begin = useCallback(async () => {
    setError(null);
    setRejected(null);
    setProposal(null);

    // On-device wins when it is loaded: it is both the private path and, on
    // this network, the working one.
    if (whisperReady) {
      whisper.current = new WhisperCapture();
      const started = await whisper.current.start({ onLive: (state) => setLive({ level: state.level, partial: '' }) });
      if (!started.ok) {
        setError(started.error.message);
        whisper.current = null;
        return;
      }
      setListening(true);
      return;
    }

    capture.current = new VoiceCapture();
    const started = await capture.current.start({
      locale,
      onLive: setLive,
      // Surfaced WHILE the button is held, not on release. Recognition can die
      // a second in — most often because Chrome could not reach the service it
      // transcribes with — and showing "listening" through that is a lie the
      // person is holding a button for.
      onError: (failure) => {
        setError(failure.message);
        setListening(false);
      },
    });
    if (!started.ok) {
      setError(started.error.message);
      capture.current = null;
      return;
    }
    setListening(true);
  }, [locale, whisperReady]);

  const end = useCallback(async () => {
    const onDevice = whisper.current;
    if (onDevice) {
      setListening(false);
      setLive({ level: 0, partial: 'transcribing on device…' });
      const heard = await onDevice.stop(locale);
      whisper.current = null;
      setLive({ level: 0, partial: '' });
      if (!heard.ok) {
        setError(heard.error.message);
        return;
      }
      setLastEngine(
        `on-device · ${loadedWhisperModel() ?? DEFAULT_WHISPER_MODEL} · ` +
          `${heard.value.seconds.toFixed(1)}s of audio transcribed in ${Math.round(heard.value.transcribeMs)}ms`,
      );
      await accept({
        transcript: heard.value.transcript,
        confidence: heard.value.confidence,
        peakRms: heard.value.peakRms,
        voicedMs: heard.value.voicedMs,
        locale,
      });
      return;
    }

    const active = capture.current;
    if (!active) return;
    setListening(false);
    const measured = await active.stop(locale);
    capture.current = null;
    if (!measured.ok) {
      setError(measured.error.message);
      return;
    }
    setLastEngine('browser · Web Speech API — this engine sends the audio to Google to transcribe');
    await accept(measured.value);
  }, [accept, locale]);

  const confirm = useCallback(() => {
    if (!proposal) return;
    const goal = edited.trim();
    if (goal === '') return;

    // Defence 5: the correction IS the teaching. No separate flow.
    const learned = diffCorrections(proposal.proposed, goal, locale, Date.now());
    if (learned.length > 0) {
      const merged = mergeCorrections(corrections, learned);
      setCorrections(merged);
      saveCorrections(merged);
    }
    setProposal(null);
    onConfirm(goal);
  }, [corrections, edited, locale, onConfirm, proposal]);

  const revert = useCallback(() => {
    if (proposal) setEdited(proposal.heard);
  }, [proposal]);

  if (!supported) {
    return (
      <div className="panel">
        <div className="panel-title">voice</div>
        <p className="note">
          This browser has no Web Speech API, so the mic is unavailable. Chrome and Edge support it. Typing the goal
          works exactly the same way.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title">voice — the transcript is a proposal, never a command</div>

      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="locale">Language</label>
        <select
          id="locale"
          value={locale}
          disabled={disabled || listening}
          onChange={(e) => {
            const next = e.target.value as VoiceLocale;
            setLocale(next);
            try {
              globalThis.localStorage?.setItem(LOCALE_KEY, next);
            } catch {
              // Not remembering the choice is a small loss.
            }
          }}
        >
          {VOICE_LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label} — {l.id}
            </option>
          ))}
        </select>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        Pinned, never auto-detected. Hinglish reaches the planner exactly as you say it.
      </p>

      {/*
        Two engines, and the honest difference between them stated before you
        press anything. The browser engine uploads the audio; the on-device one
        does not. On some networks — ours included — the browser engine returns
        nothing at all, with no error, so this is the working path as well as the
        private one.
      */}
      <div className="field" style={{ marginTop: 9 }}>
        <label>Engine</label>
        <button
          type="button"
          className="btn"
          disabled={disabled || listening || whisperReady || whisperLoad !== null}
          onClick={() => void loadVoiceModel()}
        >
          {whisperReady
            ? 'On-device ready'
            : whisperLoad !== null
              ? `${Math.round(whisperLoad.progress * 100)}%`
              : 'Load on-device voice'}
        </button>
      </div>
      {whisperLoad !== null && (
        <p className="note" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{whisperLoad.text}</p>
      )}
      <p className={whisperReady ? 'note' : 'note warn'}>
        {whisperReady ? (
          <>
            <strong>on-device</strong> — {loadedWhisperModel()} runs in this tab. The audio never leaves the
            machine. Whisper reports no confidence score, so that one gate does not apply; the energy, filler
            and script gates still do, and the transcript is still only a proposal.
          </>
        ) : (
          <>
            <strong>browser</strong> — the Web Speech API sends your audio to Google to transcribe, and on some
            networks it silently returns nothing. Press <strong>Load on-device voice</strong> for a ~40MB model
            that transcribes here instead, cached after the first load.
          </>
        )}
      </p>

      <div className="actions">
        <button
          type="button"
          className={listening ? 'btn btn-stop' : 'btn btn-primary'}
          disabled={disabled}
          onMouseDown={() => void begin()}
          onMouseUp={() => void end()}
          onMouseLeave={() => listening && void end()}
          onTouchStart={(e) => {
            e.preventDefault();
            void begin();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            void end();
          }}
        >
          {listening ? 'Listening — release to stop' : 'Hold to speak'}
        </button>
        {corrections.length > 0 && (
          <button type="button" className="btn" onClick={() => setShowTable(!showTable)}>
            {corrections.length} learned
          </button>
        )}
      </div>

      {listening && (
        <div style={{ marginTop: 10 }}>
          <div
            aria-hidden="true"
            style={{
              height: 4,
              background: '#2E2E2B',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(live.level * 100)}%`,
                background: 'var(--amber)',
                transition: 'width 80ms linear',
              }}
            />
          </div>
          <p className="note" style={{ fontFamily: 'var(--mono)', marginTop: 6 }}>
            {live.partial || 'listening…'}
          </p>
        </div>
      )}

      {lastEngine && (
        <p className="note" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          transcribed by {lastEngine}
        </p>
      )}
      {error && <p className="note warn">{error}</p>}

      {rejected && (
        <div className="row-inset" style={{ margin: '10px 0 0' }}>
          <div className="row-inset-tag">discarded · {rejected.reason}</div>
          <div className="row-inset-body">{rejected.detail}</div>
          <p className="note" style={{ marginTop: 4 }}>
            Nothing was run. A transcript this weak is far more likely to be silence than an instruction.
          </p>
        </div>
      )}

      {proposal && (
        <div style={{ marginTop: 12, border: '1px solid var(--amber)', borderRadius: 3, padding: 10 }}>
          <div className="row-inset-tag" style={{ color: 'var(--amber)' }}>
            review — nothing runs until you confirm
          </div>

          {proposal.substitutions.length > 0 && (
            <p className="note" style={{ marginTop: 6 }}>
              {proposal.substitutions.map((s, i) => (
                <span key={i} style={{ marginRight: 10 }}>
                  <s style={{ color: 'var(--paper-dim)' }}>{s.from}</s>{' '}
                  <span style={{ color: 'var(--amber)' }}>{s.to}</span>
                  <span className="k" style={{ fontSize: 10 }}> ({s.source})</span>
                </span>
              ))}
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11, marginLeft: 4 }}
                onClick={revert}
              >
                revert
              </button>
            </p>
          )}

          {proposal.surpriseScript && (
            <p className="note warn" style={{ marginTop: 6 }}>
              This came back in a different script than {locale} should produce. Recognition may have switched
              language — check it carefully.
            </p>
          )}

          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            aria-label="Review the transcript before running"
            style={{
              width: '100%',
              marginTop: 8,
              minHeight: 58,
              background: 'var(--ink)',
              border: '1px solid var(--hairline)',
              borderRadius: 3,
              color: 'var(--paper)',
              font: 'inherit',
              padding: 8,
            }}
          />

          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={edited.trim() === ''}>
              Use this goal
            </button>
            <button type="button" className="btn" onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Heard: <span style={{ fontFamily: 'var(--mono)' }}>{proposal.heard}</span>
            {proposal.confidence > 0 ? ` · ${Math.round(proposal.confidence * 100)}% confident` : ''}
          </p>
        </div>
      )}

      {showTable && (
        <div style={{ marginTop: 10 }}>
          <div className="panel-title">learned corrections — editable</div>
          {corrections.map((c) => (
            <div key={`${c.locale}:${c.heard}`} className="row" style={{ gridTemplateColumns: '1fr auto', padding: '5px 0' }}>
              <span className="row-json" style={{ whiteSpace: 'normal' }}>
                {c.heard} → <span style={{ color: 'var(--amber)' }}>{c.corrected}</span> · {c.locale} · {c.hits}×
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => {
                  const next = corrections.filter((e) => !(e.heard === c.heard && e.locale === c.locale));
                  setCorrections(next);
                  saveCorrections(next);
                }}
              >
                forget
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
