# Origo Loop

**Tell it what to test. It tests itself.**

> **Live demo:** `[[ not yet deployed — see docs/DEPLOY.md; the configs are committed and the build is verified ]]`
> **Repository:** https://github.com/Shivansh0911/IQOO_Hackathon

An AI agent that operates an app from a spoken goal. It reads the app's
**structure** rather than its pixels, plans one validated action at a time with a
small model, executes it, verifies the result, and produces a test report with
per-step evidence and a pass/fail verdict.

Built for the iQOO Hackathon 2026 (Hyderabad City Battle, Developer Tools) by
Tushya Jain and Shivansh Shekher Ojha, BITS Pilani Hyderabad.

---

## What is proven, and what is open

Stated this way deliberately. A claim a judge can check is worth more than a
claim that sounds bigger.

**PROVEN — reading structure instead of pixels makes a screen 438 tokens
instead of ~1,500.** Measured with a real BPE tokenizer across five screens
(374 best, 580 worst) and reproducible with `pnpm measure`. Checkable live in
the debug panel.

**PROVEN — the agent, the validator and every guardrail work correctly.**
Demonstrated under a model that was *not* good enough: Llama-3.2-1B produced 15
invalid actions in 20 calls and the validator caught 100% of them, with nothing
wrong ever reaching the app. That is stronger evidence than a clean run, and the
console can replay it (the Guardrails panel).

**OPEN — which 1B–2B model reliably selects a node index.** Llama-3.2-1B does
not: 75% invalid, emitting index 0 on 18 of 20 calls. **Qwen2.5-1.5B does: 0%
invalid across 20 calls, choosing indices 12, 13, 14, 17, 22 and 23 appropriately
per screen.** Gemma 3 1B via MediaPipe on the phone is untested and gets
measured at hour 4 on site.

---

## The insight, in three sentences

Every other agent that operates a screen takes a screenshot and sends the image
to a large cloud vision model. We read the structured UI tree the operating
system already maintains for accessibility — the DOM on the web, the
accessibility tree on Android — and serialise it to compact JSON, which measures
**438 tokens per screen against roughly 1,500 for a screenshot.** At that size a
1-billion-parameter model is enough to choose the next action, and a 1B model is
small enough to run on the phone — so the entire agent collapses onto the device.

---

## Measured numbers

Every number here is produced by a script in this repository. None is an
estimate, and where a measurement contradicted something we had claimed, the
claim changed.

### Screen serialisation — `pnpm measure`

Real Tiffin, real Chromium at 420×780, real BPE tokenizer.

| screen | nodes before | after | kept | tokens | drop reasons |
|---|---|---|---|---|---|
| search | 180 | 17 | 9% | 447 | invisible 17 · zero-area 1 · **offscreen 100** · no-signal 20 · text-container 25 |
| results | 63 | 15 | 24% | 410 | invisible 6 · zero-area 1 · no-signal 19 · text-container 22 |
| restaurant | 65 | 32 | 49% | **580** | invisible 2 · zero-area 1 · offscreen 15 · no-signal 15 |
| cart | 39 | 23 | 59% | 374 | invisible 1 · zero-area 1 · no-signal 13 · text-container 1 |
| checkout | 38 | 24 | 63% | 380 | invisible 4 · zero-area 1 · no-signal 8 · text-container 1 |

**Mean 438 tokens per screen · worst 580 · best 374 · ~3.4× smaller than a
screenshot.**

The 40-node cap never once binds — `offscreen` and `text-container` do the work
first. The clickable restaurant card survives pruning on every screen, which is
guaranteed structurally rather than by luck: `pruneAndRank` returns early for any
interactive node before the echo rule runs.

### Prompt size

System prompt **873 tokens** (actions 215, examples 397, the rest scaffolding),
so a typical call is ~1,450 tokens and the worst ~2,100. History compression
keeps a 24-step run within ~120 tokens of a 1-step run.

### On-device planning — `node scripts/gate2-measure.mjs`

Qwen2.5-1.5B-Instruct q4f16 on WebGPU (NVIDIA Lovelace), against real Tiffin
screens, every reply through the real validator.

| screen | tokens | calls | valid | invalid | mean latency |
|---|---|---|---|---|---|
| search | 453 | 4 | 4 | 0% | 2.4s |
| results | 407 | 4 | 4 | 0% | 2.3s |
| restaurant | 630 | 4 | 4 | 0% | 2.6s |
| cart | 407 | 4 | 4 | 0% | 2.3s |
| checkout | 414 | 4 | 4 | 0% | 2.2s |

**20 calls · 20 valid · 0% invalid-output rate · mean 4.0s per planning call.**
Cold start 136s (1.1GB, once). Warm start 3.5s.

The same protocol against Llama-3.2-1B: **75% invalid**, index 0 on 18 of 20
calls. See [docs/DECISIONS.md](docs/DECISIONS.md) D12 for the comparison and the
three prompt bugs the measurement exposed.

**0% invalid is not 100% correct.** The validator checks whether an action is
legal for the screen, not whether it was the best choice — on the search screen
Qwen sometimes taps a restaurant card rather than typing into the search field.
Quote the invalid-output rate; never call it accuracy.

### Offline — verified, and scoped precisely

**PASS:** load the model, cut the network, and the full loop keeps working — 10
of 10 planning calls with `navigator.onLine === false`. Reproduce with
`node scripts/gate2-measure.mjs 2 --warm-then-offline`.

**Does NOT work:** a cold start with no network at all. The model weights are
cached, but the lazily-imported WebLLM chunk has nothing caching it — there is
no service worker. So the honest claim is **"works with the network off once the
model is loaded"**, never "works offline" unqualified.

### The same reader on real websites — `node scripts/measure-real-sites.mjs`

Read-only, phone viewport. This is the number that says most about Android.

| site | nodes before | after | tokens | 40-cap binds |
|---|---|---|---|---|
| Wikipedia article | **13,115** | 40 | 725 | yes |
| Wikipedia search | 9,466 | 40 | 636 | yes |
| example.com | 6 | 3 | 54 | no |
| Tiffin (densest) | 180 | 17 | 447 | no |

**The token thesis scales:** a 13,115-node page still serialises to 725 tokens,
because the cap holds the ceiling. `offscreen` alone drops 10,776 of them.

**And the honest other half:** only 14 of Wikipedia's kept 40 are clickable — the
list opens with "Site", "Main menu", "Personal tools". We implemented the obvious
fix (rank interactive nodes above non-interactive before the cap, now shipped and
tested) and **measured that it changes almost nothing**: 14 → 14 on the article,
9 → 11 on the search page. The histogram says why — `overCap` is only +2, so just
42 nodes survive the drop rules and the cap is picking 40 of 42. The constraint is
the survivor pool, not the ordering. [docs/PORTING.md](docs/PORTING.md) records
that the hour-zero lever is `no-signal`, not ranking.

### The flows, walked on the production build

`node scripts/verify-flows.mjs` — clean profile, no cache, no localStorage.

| flow | result |
|---|---|
| cold first visit | Tiffin painted 411ms · RUN usable 426ms · strip honest throughout |
| typed goal | Pass in 2.4s · 6 steps · amber ring confirmed mid-run (badge 22) |
| destructive gate | sheet readable, Deny genuinely stops the run, order NOT placed |
| deliberate failure | red verdict: "node 11 reads 4.5; expected > 4.9" |
| double RUN, tab switch, back, reload | no duplicate steps, survives all four |
| 620px and 390px | both panes usable, no horizontal overflow |
| no WebGPU | degrades to mock, strip says so, run still completes |

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
   spoken goal ───▶ │  packages/planner   prompt → one action  │
                    │  packages/agent     the loop, guardrails │   PORTABLE
                    │  packages/core      contract, validator  │   (no DOM,
                    │  packages/report    the HTML report      │    enforced)
                    └────────────────┬─────────────────────────┘
                                     │  ScreenReader · ActionExecutor
                          ═══════════╪═══════════  THE BOUNDARY
                                     │
             ┌───────────────┬───────┴────────┬──────────────────┐
             ▼               ▼                ▼                  ▼
      adapters/web    adapters/extension  adapters/android   adapters/webllm
        the DOM        any real site      accessibility       the local model
      (apps/tiffin)   (apps/extension)    tree (on site)       (WebGPU)
```

Everything above the boundary is written once. `packages/agent/test/profile.test.ts`
runs the **entire agent** — loop, validator, guardrails — through a platform
profile with no browser in it at all, and reaches a Pass verdict. That test is
why "it ports to Android" is a proven property rather than a promise.

The boundaries are enforced by lint, not by discipline, and the rules are
themselves regression-tested against deliberately-violating fixtures
(`pnpm boundaries`, 8/8):

- **RULE A** — `packages/**` may not import React or touch a web global. It also
  compiles with `lib: ES2022` and no `DOM`, so `document` is a *type error*
  there, not merely a lint error.
- **RULE B** — `apps/tiffin` may not import from `@origo/*`, carry a
  `data-origo-*` attribute, or mention Origo in a string. The target app cannot
  help the agent.
- **RULE C** — nothing outside `apps/demo`, `apps/extension` and `adapters/**`
  may import an adapter. Platform facts come from `PlatformProfile`.

## Guardrails

Every one has a test with its name on it.

| guardrail | behaviour |
|---|---|
| **Never execute unvalidated output** | extract → Zod → semantic checks against the screen shown → destructive policy. A malformed action is always a retry, never a guess |
| **Index addressing** | the model picks from a menu it was just shown; a hallucinated index is provably out of range |
| **Step ceiling** | 25 actions, then Blocked |
| **Retry limit** | 2 consecutive invalid outputs, with the validator's message fed back verbatim |
| **Stuck detection** | 3 identical screens injects a reflection turn; 4 terminates. An Assert does not count — observing twice is not looping |
| **Destructive gate** | pay/order/delete/share/… suspends the loop and asks. With no handler the answer is no |
| **Cancellation** | STOP aborts within one action, including mid-inference |
| **The Assert rule** | `Finish(Pass)` with zero passed Asserts → Blocked. With a *failed* Assert → Fail |

## The three inference tiers — all free

| tier | what it is | cost | notes |
|---|---|---|---|
| **local** | Llama 3.2 1B Instruct on WebGPU, via WebLLM | nothing | Weights cached after first load. 1B is the class we will run on the phone — a 3B would score better and lie about the Android story |
| **cloud** | OpenRouter free tier | nothing | Key supplied at runtime, never committed. Absent key = tier reports unavailable, never a prompt |
| **mock** | a fixed plan, resolved against the live screen | nothing | Runs the *real* loop with no model. The status strip says `mock` the whole time |

The status strip shows the tier, the model, the network state and the token count
of the last screen, read live. A hardcoded value there is a build-breaking
defect, not a cosmetic one.

## Running it

```bash
pnpm install
pnpm dev            # the demo: Tiffin + the console
pnpm dev:debug      # the debug panel: the app beside what the agent sees
pnpm verify         # typecheck → lint → boundaries → 242 tests
pnpm measure        # the pruning and token table above, from a real browser
pnpm e2e            # drive the built demo end to end in Chromium
node scripts/build-extension.mjs   # the Chrome extension
```

No key is needed to try any of it.

## Known limitations, stated plainly

- **Tiffin is a controlled test fixture, not a third-party app.** It is ours. A
  deployed web page cannot read the DOM of a cross-origin iframe — same-origin
  policy, and real sites send `X-Frame-Options` — so a shareable link physically
  cannot drive someone else's website. Tiffin is Origo-blind by lint and is
  deliberately awkward in three places (a clickable card whose text lives in
  child elements, an icon-only button named only by `aria-label`, and a list
  requiring a scroll). **The Chrome extension is the answer to the rest of that
  question**: the same core, agent, planner and report packages, unchanged,
  driving sites we do not control.
- **The extension is read-only by design.** Its destructive gate blocks sign-in,
  post, submit, buy and upload, and the panel denies every confirmation.
- **On-device inference needs WebGPU and a capable GPU.** Chrome will silently
  hand out an integrated GPU, which changes the answer completely — see the Gate
  2 notes. Without WebGPU the app falls back and says so.
- **Every latency number here was measured in a browser on a laptop.** None of it
  transfers to a phone. It will be re-measured on the device.
- **We never claim the NPU.** MediaPipe LLM Inference on Android runs on GPU or
  CPU, not the Hexagon NPU. The word appears nowhere in the UI or in this
  document except in this sentence, saying we do not claim it.
- Token counts shown live in the UI are a calibrated estimate (~2.8 chars/token);
  `pnpm measure` reports the true BPE count.

## Documentation

- [docs/PORTING.md](docs/PORTING.md) — the hour-zero working document: every port
  method mapped web → extension → Android, the known divergences, and the adb
  checklist
- [docs/DEMO_JOURNEY.md](docs/DEMO_JOURNEY.md) — what we chose for the demo and
  what each choice becomes, plus an honest split of the 30-hour on-site build
- [docs/DECISIONS.md](docs/DECISIONS.md) — every architectural decision and its
  reason
- [docs/SUBMISSION.md](docs/SUBMISSION.md) — the Phase 1 answers
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — the video shot list
- [ATTRIBUTION.md](ATTRIBUTION.md) — from the real dependency tree
