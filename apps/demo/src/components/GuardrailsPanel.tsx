/**
 * The Guardrails panel.
 *
 * Replays REAL captured output from a real on-device model that was not good
 * enough — 15 rejections out of 20 calls, the raw text it produced, the specific
 * validator error, and what the agent did next.
 *
 * This is not a simulation and it is not a mock. The contents of
 * `captured-rejections.json` — the raw replies, the validator messages, the
 * per-call latencies — are real output from a Gate 2 measurement run
 * (scripts/gate2-measure.mjs, which writes .shots/gate2.json). They were
 * TRANSCRIBED from that run by hand rather than emitted by a script, so the
 * file cannot be regenerated with one command; the data is measured, the file
 * is not yet reproducible. Said plainly here because "generated from" would
 * imply more automation than exists.
 *
 * The panel states the model and the date on screen, because a replay
 * presented as a live run would be exactly the kind of dishonesty this whole
 * project is built to avoid.
 *
 * It is here because it is the most credible thing we have. Every team shows a
 * happy path. Almost none can show what their system does when the model is
 * wrong, with evidence.
 */

import { useState } from 'react';
import captured from '../captured-rejections.json';

interface Rejection {
  readonly screenId: string;
  readonly goal: string;
  readonly raw: string;
  readonly stage: string;
  readonly fault: string;
  readonly message: string;
  readonly latencyMs: number;
  readonly screenTokens: number;
}

const rejections = captured.rejections as readonly Rejection[];

function faultLabel(fault: string): string {
  return fault === 'malformed-output' ? 'the model produced nonsense' : 'well-formed, but wrong for this screen';
}

export function GuardrailsPanel() {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const invalid = rejections.length;
  const total = captured.totalCalls;
  const current = rejections[cursor];

  return (
    <div className="panel">
      <div className="panel-title">guardrails — what happens when the model is wrong</div>

      <p className="note" style={{ marginTop: 0 }}>
        A real on-device run where the model was <strong>not</strong> good enough: {invalid} of {total} replies were
        rejected. None of them reached the app.
      </p>

      <div className="actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn" onClick={() => setOpen(!open)}>
          {open ? 'Hide the evidence' : 'Show the evidence'}
        </button>
        {open && (
          <>
            <button
              type="button"
              className="btn"
              disabled={cursor === 0}
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
            >
              ‹ prev
            </button>
            <button
              type="button"
              className="btn"
              disabled={cursor >= invalid - 1}
              onClick={() => setCursor((c) => Math.min(invalid - 1, c + 1))}
            >
              next ›
            </button>
          </>
        )}
      </div>

      {open && current && (
        <div style={{ marginTop: 10 }}>
          <div className="row-inset-tag" style={{ color: 'var(--paper-dim)' }}>
            replay {cursor + 1} of {invalid} · captured {captured.capturedAt} · {captured.model} · {captured.runtime}
          </div>

          <div style={{ marginTop: 8 }}>
            <div className="panel-title" style={{ marginBottom: 4 }}>
              the goal, on the {current.screenId} screen ({current.screenTokens} tokens)
            </div>
            <div className="row-reason">{current.goal}</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="panel-title" style={{ marginBottom: 4 }}>
              what the model actually replied, after {current.latencyMs}ms
            </div>
            <div className="row-inset-raw" style={{ margin: 0 }}>
              {current.raw || '(empty)'}
            </div>
          </div>

          <div className="row-inset" style={{ margin: '10px 0 0' }}>
            <div className="row-inset-tag">
              rejected · {current.stage} · {faultLabel(current.fault)}
            </div>
            <div className="row-inset-body">{current.message}</div>
          </div>

          <p className="note" style={{ marginTop: 8 }}>
            The agent fed this exact message back to the model and retried. Two consecutive rejections end the run as
            Blocked. The app was never touched.
          </p>
        </div>
      )}
    </div>
  );
}
