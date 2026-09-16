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
import type { CorrectionEntry, GateVerdict, Substitution, VoiceLocale } from '@origo/core';
import { VoiceCapture, isVoiceSupported } from '@origo/adapter-web';

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

  const begin = useCallback(async () => {
    setError(null);
    setRejected(null);
    setProposal(null);
    capture.current = new VoiceCapture();
    const started = await capture.current.start({ locale, onLive: setLive });
    if (!started.ok) {
      setError(started.error.message);
      capture.current = null;
      return;
    }
    setListening(true);
  }, [locale]);

  const end = useCallback(async () => {
    const active = capture.current;
    if (!active) return;
    setListening(false);
    const measured = await active.stop(locale);
    capture.current = null;
    if (!measured.ok) {
      setError(measured.error.message);
      return;
    }

    // Defence 1: the gates. A discarded transcript can never start a run.
    const verdict = applyGates(measured.value);
    if (!verdict.accepted) {
      setRejected(verdict);
      return;
    }

    // Defence 4 and 5: learned corrections first, then the on-screen lexicon.
    const lexicon = buildLexicon(screenTexts, ['Tiffin']);
    const matched = applyLexicon(measured.value.transcript, lexicon, correctionsFor(corrections, locale));

    setProposal({
      heard: measured.value.transcript,
      proposed: matched.text,
      substitutions: matched.substitutions,
      // Defence 2: a script the pinned locale should not produce.
      surpriseScript: hasSurpriseScript(measured.value.transcript, locale),
      confidence: measured.value.confidence,
    });
    setEdited(matched.text);
  }, [corrections, locale, screenTexts]);

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
