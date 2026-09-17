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
import type { Planner, PlannerInfo, PlannerTier } from '@origo/planner';
import { createWebProfile } from '@origo/adapter-web';
import { androidProfile } from '@origo/adapter-android';
import { LocalPlanner, detectWebGpu } from '@origo/adapter-webllm';
import { statusFacts, useConsole } from './run-store.js';
import { StatusStrip } from './components/StatusStrip.js';
import { StepLog } from './components/StepLog.js';
import { ReportActions } from './components/ReportActions.js';
import { GuardrailsPanel } from './components/GuardrailsPanel.js';
import { VoiceInput } from './components/VoiceInput.js';
import { DEMO_GOALS, isScriptedGoal, scriptFor } from './demo-goals.js';
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
  const voicePanel = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);

  const [platformId, setPlatformId] = useState<'web' | 'android'>('web');
  const [tierOverride, setTierOverride] = useState<PlannerTier | 'auto'>('auto');
  const [apiKey, setApiKey] = useState<string>(() => readKey() ?? '');
  const [online, setOnline] = useState<boolean>(() => globalThis.navigator?.onLine ?? true);
  const [selectionNote, setSelectionNote] = useState<string | null>(null);
  const [load, setLoad] = useState<{ progress: number; text: string } | null>(null);
  const [gpu, setGpu] = useState<{ available: boolean; reason: string } | null>(null);
  const [adapterName, setAdapterName] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<{ state: 'ready' | 'needs-download' | 'unavailable'; detail: string } | null>(null);
  const [demoReady, setDemoReady] = useState(false);

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

  // Probed once, and reported honestly. If there is no WebGPU the UI says so
  // and why, rather than silently running somewhere else and calling it
  // on-device.
  useEffect(() => {
    void detectWebGpu().then(setGpu);
    void local.readiness().then(setReadiness);
    // The iGPU lesson, surfaced rather than buried. Chrome hands WebGPU the
    // integrated GPU by default on a laptop with both, and the SAME model went
    // from 2.3s to 41s per call on it. Naming the adapter lets a judge see why
    // their timings differ from ours.
    void (async () => {
      try {
        const gpu = (globalThis.navigator as { gpu?: { requestAdapter(o?: unknown): Promise<unknown> } }).gpu;
        const adapter = (await gpu?.requestAdapter({ powerPreference: 'high-performance' })) as
          | { info?: { vendor?: string; architecture?: string } }
          | null
          | undefined;
        if (adapter?.info) setAdapterName(`${adapter.info.vendor ?? '?'}/${adapter.info.architecture ?? '?'}`);
      } catch {
        // No adapter info is not an error; the strip simply says less.
      }
    })();
  }, []);

  // requireWarm: the local tier only advertises itself once the weights are
  // loaded, so auto-selection never silently blocks a run on a 1.1GB download.
  const local = useMemo(
    () => new LocalPlanner({ requireWarm: true, onProgress: (p) => setLoad({ progress: p.progress, text: p.text }) }),
    [],
  );

  const registry = useMemo(() => {
    // Priority order: on-device is the product, not a fallback.
    const candidates: Planner[] = [
      local,
      new CloudPlanner({ apiKey: () => (apiKey.trim() === '' ? null : apiKey.trim()) }),
      new MockPlanner({ script: [], latencyMs: 260 }),
    ];
    return new PlannerRegistry(candidates);
  }, [apiKey, local]);

  const preload = useCallback(async () => {
    setSelectionNote(null);
    setLoad({ progress: 0, text: 'starting' });
    const result = await local.preload();
    if (!result.ok) {
      setSelectionNote(result.error.message);
      setLoad(null);
      return;
    }
    setLoad({ progress: 1, text: 'ready' });
    setReadiness(await local.readiness());
  }, [local]);

  const start = useCallback(
    async (goal: string) => {
      // A ref, not the React state flag. Two fast clicks both read `running`
      // as false before the first re-render lands, and two concurrent loops on
      // one app is the worst bug a judge could trigger by accident.
      if (busy.current || state.running) return;
      busy.current = true;
      const trimmed = goal.trim();
      if (trimmed === '') {
        busy.current = false;
        return;
      }

      if (!profile.implemented) {
        setSelectionNote(`${profile.detail} Switch back to the web platform to run here.`);
        busy.current = false;
        return;
      }
      setSelectionNote(null);

      const selected = await registry.select(tierOverride === 'auto' ? undefined : tierOverride);
      if (!selected.ok) {
        setSelectionNote(selected.error.message);
        busy.current = false;
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
      busy.current = false;
    },
    [profile, registry, state.running, tierOverride],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  /**
   * Demo mode, one tap: reset Tiffin to a known state and preload the model so
   * the first action is fast. Exists because the alternative is a presenter
   * clicking four things while a judge watches.
   */
  const demoMode = useCallback(async () => {
    useTiffin.getState().reset();
    useConsole.getState().clear();
    setSelectionNote(null);
    setDemoReady(false);
    // Probe HERE rather than reading the `gpu` state.
    //
    // MEASURED BUG: the probe is async, and a presenter who clicks Demo mode
    // within the first second finds `gpu` still null — so this skipped the
    // preload, reported "Demo ready" in 0.4s, and the run then went to the mock
    // tier. It was honest (the strip said mock) and completely wrong.
    const probe = await local.readiness();
    setReadiness(probe);
    if (probe.state !== 'unavailable') {
      const result = await local.preload();
      if (!result.ok) {
        setSelectionNote(`${result.error.message} The cloud and mock tiers still work.`);
        return;
      }
      setReadiness(await local.readiness());
    }
    setDemoReady(true);
  }, [local]);

  const resetAll = useCallback(() => {
    useTiffin.getState().reset();
    useConsole.getState().clear();
    setSelectionNote(null);
  }, []);

  // The lexicon is built from what is ACTUALLY on screen right now, which is
  // why a name the user can see is a name the mic can get right.
  const screenTexts = useMemo(() => {
    if (!profile.implemented) return [];
    const read = webProfile.reader as { readSync?: () => { ok: boolean; value?: { state: { nodes: readonly { text: string; desc: string }[] } } } };
    const snapshot = read.readSync?.();
    if (!snapshot?.ok || !snapshot.value) return [];
    return snapshot.value.state.nodes.flatMap((n) => [n.text, n.desc]).filter(Boolean);
    // Re-read whenever a run ends or the log changes: that is when the screen moved.
  }, [profile.implemented, webProfile.reader, state.rows.length, state.verdict]);

  // Before the first run there is no PlannerInfo from the event stream, and the
  // strip used to read "PLANNER none". True, but unhelpful: a judge wants to
  // know what will happen when they press Run. This asks the registry which
  // tier it WOULD pick, and the strip shows that until a real run overrides it.
  const [plannedTier, setPlannedTier] = useState<PlannerInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void registry.select(tierOverride === 'auto' ? undefined : tierOverride).then((selected) => {
      if (!cancelled) setPlannedTier(selected.ok ? selected.value.planner.info : null);
    });
    return () => {
      cancelled = true;
    };
  }, [registry, tierOverride, readiness?.state]);

  const facts = statusFacts(profile, state.planner ?? plannedTier, online, state.lastTokens);
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
            <button
              type="button"
              className="mic"
              disabled={state.running}
              title="Hold the mic in the voice panel below"
              onClick={() => voicePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              MIC ↓
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
            <button type="button" className="btn" onClick={() => void demoMode()} disabled={state.running}>
              {demoReady ? 'Demo ready' : 'Demo mode'}
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

          {/*
            Told BEFORE the run, not after.

            A free-form goal on the scripted tier ends Blocked, which is the
            honest outcome — but arriving with no warning it reads as a broken
            demo, and that is exactly what a judge does first: ignore the
            example buttons and type their own goal. So the console says what
            will happen while they are still typing, and names the two ways to
            make it work.
          */}
          {!state.running && state.goal.trim().length > 0 && !isScriptedGoal(state.goal) && facts.tier === 'mock' && (
            <p className="note warn">
              This is not one of the example goals, and the scripted tier has no plan for it — pressing Run will
              end <b>Blocked</b>. To run a goal of your own, either press <b>Demo mode</b> above to load the
              on-device model (~1.1GB, once, then it works offline), or paste an OpenRouter key in Settings below.
              The example buttons run the real loop with no key and no download.
            </p>
          )}

          {selectionNote && <p className="note warn">{selectionNote}</p>}
        </div>

        <StepLog
          rows={state.rows}
          thinking={state.thinking}
          verdict={state.verdict}
          failure={state.failure}
          running={state.running}
        />

        <div ref={voicePanel}>
          <VoiceInput
            disabled={state.running}
            screenTexts={screenTexts}
            onConfirm={(goal) => {
              useConsole.getState().setGoal(goal);
              void start(goal);
            }}
          />
        </div>

        {!state.running && <ReportActions events={state.events} />}
        {!state.running && <GuardrailsPanel />}

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
              <option value="local">local — on-device, WebGPU</option>
              <option value="cloud">cloud — OpenRouter free tier</option>
              <option value="mock">mock — scripted, no model</option>
            </select>
          </div>

          <div className="field" style={{ marginTop: 7 }}>
            <label>On-device</label>
            <button type="button" className="btn" disabled={state.running || load?.progress === 1} onClick={() => void preload()}>
              {load === null ? 'Load model' : load.progress === 1 ? 'Model ready' : `${Math.round(load.progress * 100)}%`}
            </button>
          </div>
          {load !== null && load.progress < 1 && (
            <p className="note" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{load.text}</p>
          )}
          {readiness !== null && load === null && (
            <p className={readiness.state === 'unavailable' ? 'note warn' : 'note'}>
              <strong>
                {readiness.state === 'ready'
                  ? 'on-device: ready'
                  : readiness.state === 'needs-download'
                    ? 'on-device: not loaded yet'
                    : 'on-device: unavailable'}
              </strong>{' '}
              {readiness.detail}
              {readiness.state === 'needs-download' && ' Until then, runs use the cloud or mock tier and the strip says so.'}
            </p>
          )}
          {gpu !== null && !gpu.available && <p className="note warn">{gpu.reason}</p>}
          {adapterName !== null && (
            <p className="note" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              GPU {adapterName}
              {adapterName.startsWith('intel') || adapterName.startsWith('apple')
                ? ' — integrated. On a laptop with a discrete GPU, Chrome often picks the integrated one and the same model runs far slower.'
                : ''}
            </p>
          )}
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
          <p className="note" style={{ marginTop: 8 }}>
            <strong>Why two tiers?</strong> The thesis is that structured input is small enough for a small model —
            438 tokens a screen, measured. <em>Which</em> small model reliably picks a node index is a tuning question
            we are still answering, so the tier that works is the default and the strip always names it.
          </p>
        </div>
      </section>
    </div>
  );
}
