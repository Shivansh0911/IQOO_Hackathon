/**
 * The side panel.
 *
 * It reuses @origo/core, @origo/agent, @origo/planner and @origo/report
 * UNCHANGED. Not "mostly unchanged" — the imports below are the same packages
 * the hosted demo uses, at the same versions, with no extension-specific
 * branches inside them. If any of them had needed a change to work here, the
 * abstraction would have been leaking and the fix would have belonged in the
 * abstraction.
 *
 * What is different lives entirely in the profile: a reader and executor that
 * talk to a content script instead of to a DOM in the same page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { run } from '@origo/agent';
import type { RunEvent } from '@origo/agent';
import { formatAction } from '@origo/core';
import type { PlatformProfile } from '@origo/core';
import { CloudPlanner, MockPlanner, PlannerRegistry } from '@origo/planner';
import type { Planner } from '@origo/planner';
import { buildReportModel, renderReportHtml } from '@origo/report';
import { createExtensionProfile, EXTENSION_DESTRUCTIVE_PATTERNS } from '@origo/adapter-extension';
import type { ContentReply, PanelMessage } from '@origo/adapter-extension';
import { HashSettleStrategy } from '@origo/adapter-web';

const KEY_STORAGE = 'origo.openrouter.key';

/** Read-only goals. Each names a target that is safe to drive and easy to verify. */
const SUGGESTED = [
  'search Wikipedia for Hyderabad and check the article heading says Hyderabad',
  'search MDN for fetch and check a result mentions fetch',
  'find the search box on this page and check it is empty',
];

interface Connection {
  readonly tabId: number;
  readonly url: string;
  readonly title: string;
}

export function Panel() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [goal, setGoal] = useState(SUGGESTED[0] ?? '');
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const abort = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chrome.storage?.local.get(KEY_STORAGE).then((v) => setApiKey(String(v[KEY_STORAGE] ?? ''))).catch(() => undefined);
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [events.length]);

  const connect = useCallback(async () => {
    setNote(null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      setNote('No active tab.');
      return;
    }
    if (!/^https?:/.test(tab.url)) {
      // Said plainly, because it is the single most common way this fails and
      // it is a Chrome rule, not a bug in the extension.
      setNote('Chrome does not allow content scripts on this page. Open a normal http(s) site and try again.');
      return;
    }
    try {
      const reply = (await chrome.tabs.sendMessage(tab.id, { kind: 'origo:ping' })) as ContentReply;
      if (reply.kind !== 'ok:ping') throw new Error('unexpected reply');
      setConnection({ tabId: tab.id, url: reply.url, title: reply.title });
    } catch {
      setNote('The page has not loaded the content script yet. Reload the tab and press Connect again.');
    }
  }, []);

  const send = useCallback(
    async (message: PanelMessage): Promise<ContentReply> => {
      if (!connection) throw new Error('not connected');
      return (await chrome.tabs.sendMessage(connection.tabId, message)) as ContentReply;
    },
    [connection],
  );

  const profile: PlatformProfile | null = useMemo(
    () =>
      connection
        ? createExtensionProfile({
            send,
            settleStrategy: new HashSettleStrategy(),
            label: new URL(connection.url).hostname,
          })
        : null,
    [connection, send],
  );

  const registry = useMemo(
    () =>
      new PlannerRegistry([
        new CloudPlanner({ apiKey: () => (apiKey.trim() === '' ? null : apiKey.trim()) }) as Planner,
        new MockPlanner({ script: [], latencyMs: 200 }),
      ]),
    [apiKey],
  );

  const start = useCallback(async () => {
    if (!profile || running || goal.trim() === '') return;
    const selected = await registry.select();
    if (!selected.ok) {
      setNote(selected.error.message);
      return;
    }
    if (selected.value.planner.info.tier === 'mock') {
      setNote('No API key, so no model is available here. Add an OpenRouter key below to drive a real site.');
      return;
    }

    setEvents([]);
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;

    for await (const event of run(
      goal.trim(),
      {
        reader: profile.reader,
        executor: profile.executor,
        settle: profile.settleStrategy,
        planner: selected.value.planner,
        platform: profile.label,
        online: () => navigator.onLine,
        limits: { maxSteps: profile.limits.maxSteps, settleTimeoutMs: profile.limits.settleTimeoutMs },
        // Deliberately stricter than on our own app: we are a guest here.
        destructivePatterns: EXTENSION_DESTRUCTIVE_PATTERNS,
        onConfirm: () => Promise.resolve(false),
      },
      controller.signal,
    )) {
      setEvents((previous) => [...previous, event]);
    }

    setRunning(false);
    abort.current = null;
  }, [goal, profile, registry, running]);

  const download = useCallback(() => {
    const model = buildReportModel(events);
    const blob = new Blob([renderReportHtml(model)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `origo-${model.verdict.toLowerCase()}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [events]);

  const verdict = events.find((e) => e.type === 'Finished');
  const failure = events.find((e) => e.type === 'Failed');
  const tokens = [...events].reverse().find((e) => e.type === 'Planning');

  return (
    <div className="panel-root">
      <div className="status">
        <span>
          <span className="k">PLATFORM</span> <b>{profile ? profile.label : 'not connected'}</b>
        </span>
        <span>
          <span className="k">SITE</span> <b>{connection ? 'any origin' : '—'}</b>
        </span>
        <span>
          <span className="k">TOKENS</span> <b>{tokens && 'screen' in tokens ? tokens.screen.estimatedTokens : '—'}</b>
        </span>
      </div>

      <header className="masthead">
        <h1 className="wordmark">
          Origo <em>Loop</em>
        </h1>
        <p className="tagline">
          {connection ? connection.title.slice(0, 70) : 'Open a website, then connect.'}
        </p>
      </header>

      <div className="goal">
        {!connection ? (
          <button type="button" className="btn btn-primary" onClick={() => void connect()}>
            Connect to this tab
          </button>
        ) : (
          <>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} disabled={running} aria-label="Goal" />
            <div className="actions">
              {running ? (
                <button type="button" className="btn btn-stop" onClick={() => abort.current?.abort()}>
                  STOP
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void start()}>
                  Run
                </button>
              )}
              {events.length > 0 && !running && (
                <button type="button" className="btn" onClick={download}>
                  Report
                </button>
              )}
            </div>
            <div className="examples">
              {SUGGESTED.map((s) => (
                <button key={s} type="button" className="example" disabled={running} onClick={() => setGoal(s)}>
                  {s.slice(0, 46)}…
                </button>
              ))}
            </div>
          </>
        )}
        {note && <p className="note warn">{note}</p>}
        <p className="note">
          Read-only goals only. The destructive gate here blocks anything that signs in, posts, buys or submits.
        </p>
      </div>

      <div className="log">
        {events
          .filter((e) => e.type === 'ActionExecuted' || e.type === 'ActionRejected' || e.type === 'ConfirmationRequired')
          .map((e, i) => (
            <div className={e.type === 'ActionExecuted' ? 'row' : 'row-inset'} key={i}>
              {e.type === 'ActionExecuted' && (
                <>
                  <span className="row-n">{String(e.step).padStart(2, '0')}</span>
                  <div className="row-main">
                    <div className="row-reason">{e.action.reason}</div>
                    <div className="row-json">{formatAction(e.action)}</div>
                  </div>
                </>
              )}
              {e.type === 'ActionRejected' && (
                <>
                  <div className="row-inset-tag">rejected · {e.error.stage}</div>
                  <div className="row-inset-body">{e.error.message}</div>
                </>
              )}
              {e.type === 'ConfirmationRequired' && (
                <>
                  <div className="row-inset-tag">blocked · matched “{e.matched}”</div>
                  <div className="row-inset-body">
                    This extension never allows a write action on a site you do not own.
                  </div>
                </>
              )}
            </div>
          ))}

        {verdict && verdict.type === 'Finished' && (
          <div className={`verdict ${verdict.verdict.toLowerCase()}`}>
            <div className="verdict-tag">{verdict.verdict}</div>
            <div className="verdict-reason">{verdict.reason}</div>
            <div className="verdict-meta">
              {verdict.steps} steps · {(verdict.durationMs / 1000).toFixed(1)}s · {verdict.passedAsserts} assert
              {verdict.passedAsserts === 1 ? '' : 's'} passed
            </div>
          </div>
        )}
        {failure && failure.type === 'Failed' && (
          <div className="verdict fail">
            <div className="verdict-tag">Error</div>
            <div className="verdict-reason">{failure.message}</div>
          </div>
        )}
        <div ref={logEnd} />
      </div>

      <div className="panel">
        <div className="panel-title">settings</div>
        <div className="field">
          <label htmlFor="key">API key</label>
          <input
            id="key"
            type="password"
            value={apiKey}
            placeholder="sk-or-…"
            onChange={(e) => {
              setApiKey(e.target.value);
              chrome.storage?.local.set({ [KEY_STORAGE]: e.target.value }).catch(() => undefined);
            }}
          />
        </div>
        <p className="note">
          The on-device tier is not available in an extension side panel; a key is needed here. The hosted demo runs
          on-device.
        </p>
      </div>
    </div>
  );
}
