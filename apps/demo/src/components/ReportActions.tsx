/**
 * Download or copy the run report.
 *
 * The HTML is built in the browser from the event stream and handed over as a
 * Blob — no server, nothing uploaded. On Android this becomes a FileProvider
 * share intent; the generator above it does not change.
 */

import { useState } from 'react';
import type { RunEvent } from '@origo/agent';
import { buildReportModel, renderReportHtml, renderReportText } from '@origo/report';

export function ReportActions({ events }: { events: readonly RunEvent[] }) {
  const [copied, setCopied] = useState(false);

  if (events.length === 0) return null;
  const model = buildReportModel(events);
  if (model.steps.length === 0) return null;

  const download = (): void => {
    const html = renderReportHtml(model);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date(model.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = url;
    link.download = `origo-${model.verdict.toLowerCase()}-${stamp}.html`;
    link.click();
    // Revoke on the next tick: revoking synchronously races the download in
    // some browsers and silently produces an empty file.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(renderReportText(model));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard permission can be refused; the download always works.
      setCopied(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">report</div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn" onClick={download}>
          Download HTML
        </button>
        <button type="button" className="btn" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy as text'}
        </button>
      </div>
      <p className="note">
        One self-contained file — no external stylesheet, script or font — so it survives being moved anywhere.
      </p>
    </div>
  );
}
