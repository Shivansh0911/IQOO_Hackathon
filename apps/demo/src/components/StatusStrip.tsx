/**
 * The status strip.
 *
 * This is our credibility. Every field is read live at render time and none is
 * cached or hardcoded — a hardcoded value here is a build-breaking defect
 * (CLAUDE.md constraint 7). If the model is running in the cloud it says cloud;
 * if the tier is mock it says mock, plainly, so a scripted run can never be
 * mistaken for a live one.
 *
 * ON-DEVICE is shown only when the planner itself reports onDevice. The word
 * NPU appears nowhere: MediaPipe on Android runs on GPU or CPU, not Hexagon.
 */

import type { StatusFacts } from '../run-store.js';

export function StatusStrip({ facts }: { facts: StatusFacts }) {
  return (
    <div className="status" role="status" aria-live="polite">
      <span>
        <span className="k">PLATFORM</span>{' '}
        <b className={facts.platformOk ? undefined : 'warn'}>{facts.platform}</b>
        {!facts.platformOk && <span className="warn"> (not available here)</span>}
      </span>
      <span>
        <span className="k">PLANNER</span> <b>{facts.tier ?? 'none'}</b>
        {facts.onDevice && <span className="on-device"> on-device</span>}
      </span>
      <span>
        <span className="k">MODEL</span> <b>{facts.model}</b>
      </span>
      <span>
        <span className="k">NETWORK</span> <b>{facts.online ? 'on' : 'off'}</b>
      </span>
      <span>
        <span className="k">TOKENS</span> <b>{facts.tokens === null ? '—' : facts.tokens}</b>
        {facts.tokens !== null && <span className="k"> est/screen</span>}
      </span>
    </div>
  );
}
