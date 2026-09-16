/**
 * The live step log.
 *
 * Newest at the bottom, auto-scrolling. Rejections, retries and reflection turns
 * render as DISTINCT INSET ROWS and are never hidden: showing the recovery
 * working is the strongest technical-depth signal we have, and a judge who sees
 * a bad model output get caught and corrected learns more about the system than
 * one who sees a suspiciously clean run.
 */

import { useEffect, useRef } from 'react';
import { ACTION_GLYPHS, formatAction } from '@origo/core';
import type { LogRow, Verdict } from '../run-store.js';

function StepRow({ row }: { row: Extract<LogRow, { kind: 'step' }> }) {
  const failed = row.status === 'failed';
  const meta =
    row.status === 'running' ? '…'
    : `${row.latencyMs}ms plan · ${row.durationMs}ms act`;

  return (
    <div className="row">
      <span className="row-n">{String(row.step).padStart(2, '0')}</span>
      <span className="row-glyph">{ACTION_GLYPHS[row.action.type]}</span>
      <div className="row-main">
        <div className="row-reason">{row.reason}</div>
        <div className="row-json" title={JSON.stringify(row.action)}>
          {formatAction(row.action)}
          {row.detail ? ` — ${row.detail}` : ''}
        </div>
        {row.assert && (
          <div className="row-json" style={{ color: row.assert.passed ? '#4fae74' : '#ff7a72' }}>
            {row.assert.passed ? 'PASS' : 'FAIL'} — {row.assert.detail}
          </div>
        )}
        {!row.settled && <div className="row-json">screen had not settled when the timeout elapsed</div>}
      </div>
      <span className={`row-meta ${failed ? 'bad' : row.status === 'ok' ? 'ok' : ''}`}>{meta}</span>
    </div>
  );
}

export function StepLog({
  rows,
  thinking,
  verdict,
  failure,
  running,
}: {
  rows: readonly LogRow[];
  thinking: { step: number; tokens: number; attempt: number } | null;
  verdict: Verdict | null;
  failure: { kind: string; message: string } | null;
  running: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows.length, thinking, verdict, failure]);

  if (rows.length === 0 && !thinking && !verdict && !failure) {
    return (
      <div className="log">
        <p className="log-empty">
          Type a goal, or pick one below, and press Run. The agent reads the app on the left as a structured tree,
          asks the model for one action, checks it, performs it, and repeats.
        </p>
        <p className="log-empty">
          Every step it takes — and every one it gets wrong and recovers from — appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="log">
      {rows.map((row, i) => {
        if (row.kind === 'step') return <StepRow key={i} row={row} />;

        if (row.kind === 'rejected') {
          return (
            <div className="row-inset" key={i}>
              <div className="row-inset-tag">
                rejected · {row.stage} · {row.fault === 'malformed-output' ? 'model output malformed' : 'invalid for this screen'} · attempt {row.attempt}
              </div>
              <div className="row-inset-body">{row.message}</div>
              <div className="row-inset-raw">{row.raw.slice(0, 220)}</div>
            </div>
          );
        }

        if (row.kind === 'stuck') {
          return (
            <div className="row-inset stuck" key={i}>
              <div className="row-inset-tag">{row.terminating ? 'stuck · terminating' : 'stuck · reflecting'}</div>
              <div className="row-inset-body">
                The screen has been identical for {row.repeats} reads.{' '}
                {row.terminating
                  ? 'The reflection did not help, so the run ends here rather than burning the step budget.'
                  : 'Telling the model to try a different approach.'}
              </div>
            </div>
          );
        }

        return (
          <div className="row-inset stuck" key={i}>
            <div className="row-inset-tag">
              destructive · matched “{row.matched}” · {row.allowed === null ? 'waiting' : row.allowed ? 'allowed once' : 'denied'}
            </div>
            <div className="row-inset-body">{formatAction(row.action)}</div>
          </div>
        );
      })}

      {thinking && (
        <div className="thinking">
          <span className="caret" />
          <span>
            planning step {String(thinking.step).padStart(2, '0')} over {thinking.tokens} tokens of screen
            {thinking.attempt > 1 ? ` · retry ${thinking.attempt - 1}` : ''}
          </span>
        </div>
      )}

      {verdict && (
        <div className={`verdict ${verdict.verdict.toLowerCase()}`}>
          <div className="verdict-tag">{verdict.verdict}</div>
          <div className="verdict-reason">{verdict.reason}</div>
          <div className="verdict-meta">
            {verdict.steps} steps · {(verdict.durationMs / 1000).toFixed(1)}s · {verdict.passedAsserts} assert
            {verdict.passedAsserts === 1 ? '' : 's'} passed
            {verdict.failedAsserts > 0 ? ` · ${verdict.failedAsserts} failed` : ''}
          </div>
        </div>
      )}

      {failure && (
        <div className="verdict fail">
          <div className="verdict-tag">Error</div>
          <div className="verdict-reason">{failure.message}</div>
          <div className="verdict-meta">
            {failure.kind === 'model-output' ? 'the planner could not answer'
            : failure.kind === 'execution' ? 'the action could not be performed on this platform'
            : 'the screen could not be read'}
          </div>
        </div>
      )}

      {running && rows.length > 0 && !thinking && <div className="thinking"><span className="caret" /><span>working</span></div>}
      <div ref={end} />
    </div>
  );
}
