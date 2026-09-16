/**
 * The DOM reader debug panel.
 *
 * Tiffin on the left, exactly what the agent would see on the right: the
 * serialised screen JSON, the prune histogram, the token count, and every
 * candidate the traversal found with the rule that dropped it.
 *
 * This is a dev tool, not the product. It exists so that when a run goes wrong
 * we can tell in five seconds whether the model was confused or the node it
 * needed was never shown to it.
 */

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TiffinApp, useTiffin } from '@tiffin/app';
import '@tiffin/app/styles.css';
import { DomScreenReader } from '@origo/adapter-web';
import type { DetailedRead } from '@origo/adapter-web';
import { DROP_REASONS, formatPruneStats } from '@origo/core';

const S = {
  shell: { display: 'grid', gridTemplateColumns: '420px 1fr', height: '100%', background: '#0E0E0E' },
  pane: { borderRight: '1px solid #2E2E2B', height: '100%', overflow: 'hidden' },
  panel: {
    color: '#F7F5EF',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    padding: 16,
    overflowY: 'auto',
    height: '100%',
  },
  h: { color: '#A8A6A0', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 10, margin: '18px 0 6px' },
  box: { border: '1px solid #2E2E2B', background: '#1A1A18', padding: 10, borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  btn: { background: '#1A1A18', color: '#F5B400', border: '1px solid #2E2E2B', borderRadius: 4, padding: '6px 10px', font: 'inherit', cursor: 'pointer', marginRight: 6 },
} as const;

function Panel() {
  const host = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState<DetailedRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useTiffin((s) => s.route);
  const query = useTiffin((s) => s.query);
  const lines = useTiffin((s) => s.lines);

  const readerRef = useRef<DomScreenReader | null>(null);
  if (!readerRef.current) {
    readerRef.current = new DomScreenReader({
      appId: 'tiffin',
      root: () => host.current?.firstElementChild ?? null,
      screenId: () => useTiffin.getState().route.name,
    });
  }

  const refresh = useCallback(() => {
    const result = readerRef.current?.readDetailed();
    if (!result) return;
    if (result.ok) {
      setRead(result.value);
      setError(null);
    } else {
      setRead(null);
      setError(result.error.message);
    }
  }, []);

  // Re-read after the app has painted the new screen.
  useEffect(() => {
    const id = setTimeout(refresh, 60);
    return () => clearTimeout(id);
  }, [refresh, route.name, query, lines]);

  const snapshot = read?.snapshot;

  return (
    <div style={S.shell}>
      <div style={S.pane} ref={host}>
        <TiffinApp />
      </div>
      <div style={S.panel as React.CSSProperties}>
        <div>
          <button type="button" style={S.btn} onClick={refresh}>
            re-read
          </button>
          <button type="button" style={S.btn} onClick={() => useTiffin.getState().reset()}>
            reset tiffin
          </button>
        </div>

        {error && <div style={{ ...S.box, color: '#E2231A', marginTop: 12 }}>{error}</div>}

        {snapshot && (
          <>
            <div style={S.h as React.CSSProperties}>screen</div>
            <div style={S.box as React.CSSProperties}>
              {snapshot.state.appId}/{snapshot.state.screenId} · hash {snapshot.hash} ·{' '}
              <span style={{ color: '#F5B400' }}>{snapshot.estimatedTokens} est. tokens</span>
            </div>

            <div style={S.h as React.CSSProperties}>prune</div>
            <div style={S.box as React.CSSProperties}>
              {formatPruneStats(snapshot.stats)}
              {'\n'}
              {DROP_REASONS.map((r) => `${r.padEnd(15)} ${snapshot.stats.dropped[r]}`).join('\n')}
              {'\n'}
              {'over-cap'.padEnd(15)} {snapshot.stats.overCap}
            </div>

            <div style={S.h as React.CSSProperties}>prompt json — exactly what the model sees</div>
            <div style={{ ...S.box, color: '#F5B400' } as React.CSSProperties}>{snapshot.promptJson}</div>

            <div style={S.h as React.CSSProperties}>kept nodes ({snapshot.state.nodes.length})</div>
            <div style={S.box as React.CSSProperties}>
              {snapshot.state.nodes
                .map(
                  (n) =>
                    `${String(n.index).padStart(2)} ${n.role.padEnd(6)} ${[
                      n.clickable ? 'clk' : '',
                      n.editable ? 'ed' : '',
                      n.scrollable ? 'scr' : '',
                    ]
                      .filter(Boolean)
                      .join(',')
                      .padEnd(10)} ${(n.text || n.desc || '—').slice(0, 44)}`,
                )
                .join('\n')}
            </div>

            <div style={S.h as React.CSSProperties}>every candidate and its fate ({read.candidates.length})</div>
            <div style={{ ...S.box, color: '#A8A6A0', maxHeight: 340, overflowY: 'auto' } as React.CSSProperties}>
              {read.candidates
                .map((c) => {
                  const fate = read.fates.get(c.id) ?? '—';
                  const mark = fate === 'kept' ? '+' : '-';
                  return `${mark} ${String(c.id).padStart(3)} ${c.role.padEnd(6)} ${String(fate).padEnd(15)} ${(c.text || c.desc || '').slice(0, 34)}`;
                })
                .join('\n')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('debug panel: #root missing');
createRoot(rootEl).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
