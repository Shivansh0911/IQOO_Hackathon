/**
 * The split-pane demo.
 *
 * Left: Tiffin, which knows nothing about any of this. Right: the console.
 *
 * This file is one of only three places allowed to name an adapter directly
 * (RULE C) — something has to build the profile. Everything downstream reads
 * its platform facts from the PlatformProfile object, which is why adding
 * Android later means adding one object and changing one line here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TiffinApp, useTiffin } from '@tiffin/app';
import '@tiffin/app/styles.css';
import { run } from '@origo/agent';
import type { PlatformProfile, UiNode } from '@origo/core';
import { formatAction } from '@origo/core';
import { CloudPlanner, MockPlanner, PlannerRegistry } from '@origo/planner';
import type { Planner, PlannerTier } from '@origo/planner';
import { createWebProfile } from '@origo/adapter-web';
import { androidProfile } from '@origo/adapter-android';
import { statusFacts, useConsole } from './run-store.js';
import { StatusStrip } from './components/StatusStrip.js';
import { StepLog } from './components/StepLog.js';
import { ReportActions } from './components/ReportActions.js';
import { DEMO_GOALS, scriptFor } from './demo-goals.js';
import { ScriptedPlanner } from './scripted-planner.js';
import './styles.css';

const KEY_STORAGE = 'origo.openrouter.key';

/** Read at runtime from localStorage or an env var. Never committed. */
function readKey(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(KEY_STORAGE);
    if (stored) return stored;
  } catch {
    // Private windows and blocked storage are normal, not exceptional.
  }
  const fromEnv = import.meta.env.VITE_OPENROUTER_KEY as string | undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/** The ring drawn over whatever the agent is acting on, with its node index. */
function Ring({ node, host }: { node: UiNode | null; host: HTMLElement | null }) {
  if (!node || !host) return null;
  const pad = 2;
  return (
    <div
      className="ring"
      style={{
        left: node.bounds.x - pad,
        top: node.bounds.y - pad,
        width: node.bounds.w + pad * 2,
        height: node.bounds.h + pad * 2,
      }}
    >
      <span className="ring-badge">{node.index}</span>
    </div>
  );
}

export function App() {
  const stage = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const [platformId, setPlatformId] = useState<'web' | 'android'>('web');
  const [tierOverride, setTierOverride] = useState<PlannerTier | 'auto'>('auto');
  const [apiKey, setApiKey] = useState<string>(() => readKey() ?? '');
  const [online, setOnline] = useState<boolean>(() => globalThis.navigator?.onLine ?? true);
  const [selectionNote, setSelectionNote] = useState<string | null>(null);

  const state = useConsole();

  // The network indicator is read from the browser, live. It is never assumed,
  // because "works offline" is a claim we make and the strip must be able to
  // show it being true.
  useEffect(() => {
    const update = (): void => setOnline(globalThis.navigator.onLine);
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);

  const webProfile = useMemo(
    () =>
      createWebProfile({
        appId: 'tiffin',
        root: () => stage.current?.querySelector('.tiffin') ?? null,
        screenId: () => useTiffin.getState().route.name,
      }),
    [],
  );

  // The one line that changes when Android arrives.
  const profile: PlatformProfile = platformId === 'web' ? webProfile : androidProfile;

  const registry = useMemo(() => {
    const candidates: Planner[] = [
      new CloudPlanner({ apiKey: () => (apiKey.trim() === '' ? null : apiKey.trim()) }),
      new MockPlanner({ script: [], latencyMs: 260 }),
    ];
    return new PlannerRegistry(candidates);
  }, [apiKey]);

  const start = useCallback(
    async (goal: string) => {
      if (state.running) return;
      const trimmed = goal.trim();
      if (trimmed === '') return;

      if (!profile.implemented) {
        setSelectionNote(`${profile.detail} Switch back to the web platform to run here.`);
        return;
      }
      setSelectionNote(null);

      const selected = await registry.select(tierOverride === 'auto' ? undefined : tierOverride);
      if (!selected.ok) {
        setSelectionNote(selected.error.message);
        return;
      }

      // The mock tier is scripted per goal, so a demo without a key still runs
      // the real loop end to end — and the strip says "mock" throughout.
      let planner = selected.value.planner;
      if (planner.info.tier === 'mock') {
        planner = new ScriptedPlanner(scriptFor(trimmed));
      }

      const controller = new AbortController();
      abort.current = controller;
      useConsole.getState().beginRun(trimmed);

      for await (const event of run(
        trimmed,
        {
          reader: profile.reader,
          executor: profile.executor,
          settle: profile.settleStrategy,
          planner,
          platform: profile.label,
          online: () => globalThis.navigator.onLine,
          limits: { maxSteps: profile.limits.maxSteps, settleTimeoutMs: profile.limits.settleTimeoutMs },
          onConfirm: ({ action, matched }) =>
            new Promise<boolean>((resolve) => {
              useConsole.getState().askConfirmation({
                step: useConsole.getState().rows.length,
                action: action.action,
                target: action.target,
                matched,
                resolve,
              });
            }),
        },
        controller.signal,
      )) {
        useConsole.getState().apply(event);
      }
      abort.current = null;
    },
    [profile, registry, state.running, tierOverride],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  const resetAll = useCallback(() => {
    useTiffin.getState().reset();
    useConsole.getState().clear();
    setSelectionNote(null);
  }, []);

  const facts = statusFacts(profile, state.planner, online, state.lastTokens);
  const pending = state.pending;

  return (
    <div className="shell">
      <section className="stage">
        <div className="stage-label">
          <span>target app — tiffin</span>
          <span>{profile.capabilities.crossOriginLimited ? 'same-origin only' : 'any app'}</span>
        </div>
        <div className="stage-surface" ref={stage}>
          <TiffinApp />
          <Ring node={state.highlight} host={stage.current} />
          {pending && (
            <div className="sheet" role="alertdialog" aria-label="Confirm a destructive action">
              <div className="sheet-tag">confirmation required</div>
              <h3>This looks destructive</h3>
              <p>
                The agent wants to <code>{formatAction(pending.action)}</code> on{' '}
                <code>{pending.target?.text || pending.target?.desc || 'an element'}</code>, which matched the
                pattern <code>{pending.matched}</code>.
              </p>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => useConsole.getState().resolveConfirmation(true)}>
                  Allow once
                </button>
                <button type="button" className="btn" onClick={() => useConsole.getState().resolveConfirmation(false)}>
                  Deny
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="console">
        <StatusStrip facts={facts} />

        <header className="masthead">
          <h1 className="wordmark">
            Origo <em>Loop</em>
          </h1>
          <p className="tagline">
            Tell it what to test. It tests itself — reading the app&rsquo;s structure, not its pixels.
          </p>
        </header>

        <div className="goal">
          <div className="goal-row">
            <textarea
              value={state.goal}
              onChange={(e) => useConsole.getState().setGoal(e.target.value)}
              placeholder="e.g. biryani search karo, pehle restaurant se ek item cart mein daalo, aur check karo total ₹500 se kam hai"
              disabled={state.running}
              aria-label="What should the agent test?"
            />
            <button type="button" className="mic" disabled title="Voice arrives in step 10">
              MIC
            </button>
          </div>

          <div className="actions">
            {state.running ? (
              <button type="button" className="btn btn-stop" onClick={stop}>
                STOP
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void start(state.goal)}>
                Run
              </button>
            )}
            <button type="button" className="btn" onClick={resetAll} disabled={state.running}>
              Reset
            </button>
          </div>

          <div className="examples">
            {DEMO_GOALS.map((g) => (
              <button
                key={g.goal}
                type="button"
                className="example"
                title={g.shows}
                disabled={state.running}
                onClick={() => {
                  useTiffin.getState().reset();
                  useConsole.getState().setGoal(g.goal);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>

          {selectionNote && <p className="note warn">{selectionNote}</p>}
        </div>

        <StepLog
          rows={state.rows}
          thinking={state.thinking}
          verdict={state.verdict}
          failure={state.failure}
          running={state.running}
        />

        {!state.running && <ReportActions events={state.events} />}

        <div className="panel">
          <div className="panel-title">settings</div>
          <div className="field">
            <label htmlFor="platform">Platform</label>
            <select
              id="platform"
              value={platformId}
              disabled={state.running}
              onChange={(e) => setPlatformId(e.target.value as 'web' | 'android')}
            >
              <option value="web">web — this page</option>
              <option value="android">android — on the phone (not implemented here)</option>
            </select>
          </div>
          <div className="field" style={{ marginTop: 7 }}>
            <label htmlFor="tier">Planner</label>
            <select
              id="tier"
              value={tierOverride}
              disabled={state.running}
              onChange={(e) => setTierOverride(e.target.value as PlannerTier | 'auto')}
            >
              <option value="auto">auto — best available</option>
              <option value="cloud">cloud — OpenRouter free tier</option>
              <option value="mock">mock — scripted, no model</option>
            </select>
          </div>
          <div className="field" style={{ marginTop: 7 }}>
            <label htmlFor="key">API key</label>
            <input
              id="key"
              type="password"
              value={apiKey}
              placeholder="optional — sk-or-…"
              disabled={state.running}
              onChange={(e) => {
                setApiKey(e.target.value);
                try {
                  globalThis.localStorage?.setItem(KEY_STORAGE, e.target.value);
                } catch {
                  // Storage being unavailable only costs convenience.
                }
              }}
            />
          </div>
          <p className="note">
            No key is needed to try this. Without one the mock tier runs the real loop against a scripted plan, and
            the strip above says so.
          </p>
        </div>
      </section>
    </div>
  );
}
