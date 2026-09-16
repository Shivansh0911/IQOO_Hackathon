/**
 * The self-contained HTML report.
 *
 * ONE file. CSS inlined, evidence embedded, no external asset of any kind — no
 * font, no script, no image URL. It has to survive being emailed, dropped in a
 * Slack thread, or pulled off a phone onto a laptop over the bridge, which is
 * exactly how it will travel on site.
 *
 * It matches the console's design system on purpose: a judge who saw the run
 * should recognise the artefact it produced, and a test report that looks like a
 * stack trace reads as an afterthought.
 */

import { ACTION_GLYPHS, formatAction } from '@origo/core';
import type { ReportModel, ReportStep } from './model.js';

/** Escapes text for HTML. Everything user- or model-supplied goes through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root{--ink:#0e0e0e;--raised:#1a1a18;--paper:#f7f5ef;--dim:#a8a6a0;--amber:#f5b400;--red:#e2231a;--green:#0a7c3a;--line:#2e2e2b;
--mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;--sans:'Inter','Segoe UI',system-ui,sans-serif;
--display:'Archivo Narrow','Arial Narrow',sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--paper);font-family:var(--sans);font-size:13.5px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:28px 20px 64px}
header{border-bottom:1px solid var(--line);padding-bottom:18px}
.brand{font-family:var(--display);font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
.verdict{font-family:var(--display);font-size:56px;line-height:1;text-transform:uppercase;margin:10px 0 4px}
.verdict.pass{color:var(--green)}.verdict.fail{color:var(--red)}
.verdict.blocked,.verdict.error{color:var(--amber)}
.reason{font-size:15px;margin:0 0 16px}
.goal{border-left:2px solid var(--amber);padding:8px 12px;background:var(--raised);margin:0 0 16px;font-size:14.5px}
.facts{display:flex;flex-wrap:wrap;gap:0 22px;font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.facts b{color:var(--paper);font-weight:500}
.facts .k{color:#6e6c66}
h2{font-family:var(--display);font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:30px 0 10px;font-weight:600}
.step{border:1px solid var(--line);border-radius:3px;margin-bottom:8px;background:var(--raised)}
.step>summary{cursor:pointer;list-style:none;padding:10px 12px;display:grid;grid-template-columns:26px 16px 1fr auto;gap:9px;align-items:baseline}
.step>summary::-webkit-details-marker{display:none}
.n,.glyph,.meta{font-family:var(--mono);font-size:11px;color:var(--dim)}
.glyph{color:var(--amber)}
.meta{text-align:right;white-space:nowrap}
.meta.ok{color:var(--green)}.meta.bad{color:var(--red)}
.act{display:block;font-family:var(--mono);font-size:10.5px;color:#6e6c66;margin-top:3px}
.evidence{border-top:1px solid var(--line);padding:11px 12px;font-family:var(--mono);font-size:11px;color:var(--dim)}
.evidence div{margin-bottom:6px}
.evidence .json{color:var(--amber);word-break:break-all;white-space:pre-wrap;background:var(--ink);padding:8px;border-radius:3px}
.assert{padding:8px 12px;font-size:12.5px;border-top:1px solid var(--line)}
.assert.pass{color:#4fae74}.assert.fail{color:#ff7a72}
.inset{margin:0 12px 10px;border-left:2px solid var(--red);background:rgba(226,35,26,.06);padding:8px 10px}
.inset .tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--red)}
.inset .raw{font-family:var(--mono);font-size:10.5px;color:#6e6c66;margin-top:4px;white-space:pre-wrap;word-break:break-all}
.inset.amber{border-left-color:var(--amber);background:rgba(245,180,0,.07)}
.inset.amber .tag{color:var(--amber)}
table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11.5px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{color:#6e6c66;font-weight:500}
.note{color:var(--dim);font-size:12px}
footer{margin-top:34px;border-top:1px solid var(--line);padding-top:12px;font-family:var(--mono);font-size:10.5px;color:#6e6c66}
`;

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function stepHtml(step: ReportStep): string {
  const failed = step.status === 'failed';
  const rejections = step.rejections
    .map(
      (r) => `<div class="inset">
      <div class="tag">rejected · ${escapeHtml(r.stage)} · ${r.fault === 'malformed-output' ? 'model output malformed' : 'invalid for this screen'} · attempt ${r.attempt}</div>
      <div>${escapeHtml(r.message)}</div>
      <div class="raw">${escapeHtml(r.raw.slice(0, 400))}</div>
    </div>`,
    )
    .join('');

  const confirmation = step.confirmation
    ? `<div class="inset amber">
      <div class="tag">destructive · matched &ldquo;${escapeHtml(step.confirmation.matched)}&rdquo; · ${step.confirmation.allowed ? 'allowed once by a human' : 'denied'}</div>
      <div>The run suspended here and asked before acting.</div>
    </div>`
    : '';

  const assert = step.assert
    ? `<div class="assert ${step.assert.passed ? 'pass' : 'fail'}">${step.assert.passed ? 'PASS' : 'FAIL'} — ${escapeHtml(step.assert.detail)}</div>`
    : '';

  const target = step.target
    ? `<div>target: node ${step.target.index} · ${escapeHtml(step.target.role)} · ${escapeHtml(step.target.text || step.target.desc || '(no text)')} · at ${step.target.bounds.x},${step.target.bounds.y} ${step.target.bounds.w}×${step.target.bounds.h}</div>`
    : '';

  return `<details class="step">
    <summary>
      <span class="n">${String(step.step).padStart(2, '0')}</span>
      <span class="glyph">${ACTION_GLYPHS[step.action.type]}</span>
      <span>
        ${escapeHtml(step.reason)}
        <span class="act">${escapeHtml(formatAction(step.action))}${step.detail ? ` — ${escapeHtml(step.detail)}` : ''}</span>
      </span>
      <span class="meta ${failed ? 'bad' : step.status === 'ok' ? 'ok' : ''}">${ms(step.planMs)} plan · ${ms(step.actMs)} act</span>
    </summary>
    ${assert}
    ${rejections}
    ${confirmation}
    <div class="evidence">
      <div>screen: ${escapeHtml(step.screenId)} · ${step.screenTokens} est. tokens · settled in ${ms(step.settleMs)}${step.settled ? '' : ' (TIMED OUT before settling)'}</div>
      ${target}
      <div>what the model was shown:</div>
      <div class="json">${escapeHtml(step.screenJson)}</div>
    </div>
  </details>`;
}

/**
 * Renders the whole report.
 *
 * The header states the planner tier and network state without softening them:
 * a run planned in the cloud says so, and a mock run says so, because a report
 * that overstates how it was produced is worthless as evidence.
 */
export function renderReportHtml(model: ReportModel): string {
  const started = new Date(model.startedAt).toISOString().replace('T', ' ').slice(0, 19);
  const tierNote =
    model.plannerTier === 'mock'
      ? 'scripted plan — no model was consulted'
      : model.onDevice
        ? 'inference ran on this device'
        : 'inference ran in the cloud';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Origo Loop — ${escapeHtml(model.verdict)} — ${escapeHtml(model.goal.slice(0, 60))}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">Origo Loop · test report</div>
    <div class="verdict ${model.verdict.toLowerCase()}">${escapeHtml(model.verdict)}</div>
    <p class="reason">${escapeHtml(model.reason)}</p>
    <p class="goal">${escapeHtml(model.goal)}</p>
    <div class="facts">
      <span><span class="k">WHEN</span> <b>${started} UTC</b></span>
      <span><span class="k">DURATION</span> <b>${ms(model.durationMs)}</b></span>
      <span><span class="k">STEPS</span> <b>${model.steps.length}</b></span>
      <span><span class="k">ASSERTS</span> <b>${model.passedAsserts} passed${model.failedAsserts > 0 ? `, ${model.failedAsserts} failed` : ''}</b></span>
      <span><span class="k">PLATFORM</span> <b>${escapeHtml(model.platform)}</b></span>
      <span><span class="k">PLANNER</span> <b>${escapeHtml(model.plannerTier)}</b></span>
      <span><span class="k">MODEL</span> <b>${escapeHtml(model.plannerModel)}</b></span>
      <span><span class="k">NETWORK</span> <b>${model.online ? 'on' : 'off'}</b></span>
    </div>
    <p class="note" style="margin-top:8px">${escapeHtml(tierNote)}.</p>
  </header>

  <h2>Steps</h2>
  ${model.steps.map(stepHtml).join('\n') || '<p class="note">No steps were taken.</p>'}

  <h2>Engineering</h2>
  <details>
    <summary class="note" style="cursor:pointer">per-step timings, token counts and recovery</summary>
    <table>
      <tr><th>step</th><th>action</th><th>plan</th><th>act</th><th>settle</th><th>screen tokens</th><th>rejections</th></tr>
      ${model.steps
        .map(
          (s) =>
            `<tr><td>${String(s.step).padStart(2, '0')}</td><td>${escapeHtml(s.action.type)}</td><td>${ms(s.planMs)}</td><td>${ms(s.actMs)}</td><td>${ms(s.settleMs)}</td><td>${s.screenTokens}</td><td>${s.rejections.length}</td></tr>`,
        )
        .join('')}
    </table>
    <p class="note" style="margin-top:10px">
      mean planning latency ${ms(model.meanPlanMs)} · mean screen ${model.meanScreenTokens} est. tokens ·
      worst screen ${model.worstScreenTokens} · ${model.rejectionCount} rejected output${model.rejectionCount === 1 ? '' : 's'} ·
      ${model.stuckCount} stuck detection${model.stuckCount === 1 ? '' : 's'}
    </p>
    <p class="note">
      Token counts are estimates from a calibrated heuristic (~2.8 characters per token, measured against a
      BPE tokenizer). Timings were measured on the platform named above and do not transfer to another one.
    </p>
  </details>

  <footer>
    Generated by Origo Loop. This file is self-contained: no external stylesheet, script, font or image.
  </footer>
</div>
</body>
</html>`;
}

/** The same run as plain text, for pasting into a chat or an issue. */
export function renderReportText(model: ReportModel): string {
  const lines = [
    `ORIGO LOOP — ${model.verdict}`,
    `goal: ${model.goal}`,
    `${model.reason}`,
    '',
    `platform ${model.platform} · planner ${model.plannerTier} (${model.plannerModel}) · network ${model.online ? 'on' : 'off'}`,
    `${model.steps.length} steps · ${ms(model.durationMs)} · ${model.passedAsserts} asserts passed${model.failedAsserts > 0 ? `, ${model.failedAsserts} failed` : ''}`,
    '',
  ];
  for (const step of model.steps) {
    lines.push(`${String(step.step).padStart(2, '0')}  ${formatAction(step.action)}  — ${step.reason}`);
    for (const r of step.rejections) lines.push(`      rejected (${r.stage}): ${r.message}`);
    if (step.confirmation) {
      lines.push(`      destructive "${step.confirmation.matched}" — ${step.confirmation.allowed ? 'allowed' : 'denied'}`);
    }
    if (step.assert) lines.push(`      ${step.assert.passed ? 'PASS' : 'FAIL'}: ${step.assert.detail}`);
  }
  lines.push('', `mean plan ${ms(model.meanPlanMs)} · mean screen ${model.meanScreenTokens} est. tokens`);
  return lines.join('\n');
}
