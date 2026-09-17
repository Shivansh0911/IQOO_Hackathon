# Origo Loop — Project Constitution

Read this before every task. If a request conflicts with this file, say so before coding.

## What we are building
An AI agent that operates any app from a spoken goal. It reads the app's UI as a
structured tree (DOM on web now, Android accessibility tree later), serialises it to
compact JSON, plans one validated action at a time with a small local LLM, executes it,
verifies the result, and emits a self-contained HTML test report.

Tagline: Tell your phone what to test. It tests itself. Fully offline.

## Two jobs
JOB 1 (now) — a deployed, publicly linkable web demo for hackathon qualification.
  Deadline 22 Sep 2026, 23:59 IST.
JOB 2 (later) — the same codebase ports to Android on-site in 30 hours, swapping only
  the platform adapters. Core logic is written once and reused unchanged.

## Non-negotiable constraints
1. CORE IS PLATFORM-AGNOSTIC. packages/** must contain zero web-specific code: no DOM
   types, no window/document/localStorage, no React. Machine-enforced by RULE A.
2. TIFFIN IS ORIGO-BLIND. apps/tiffin must never import from @origo/*, never carry
   data-origo-* attributes, never mention Origo. Machine-enforced by RULE B. If Tiffin
   helps the agent, the demo is a lie and the pitch collapses.
3. NEVER EXECUTE UNVALIDATED MODEL OUTPUT. Parse → Zod → semantic checks → whitelist →
   execute. A malformed action is always a retry, never a guess or a default.
4. NODE ADDRESSING BY ASSIGNED INDEX ONLY. Never coordinates, selectors or text matchers.
   This is what makes constraint 3 enforceable rather than aspirational.
5. THE AGENT MUST BE INTERRUPTIBLE. STOP aborts within one action, including
   mid-inference.
6. EVERYTHING FREE. No paid APIs, no paid hosting, no key required for a stranger to use
   the deployed link.
7. THE STATUS STRIP NEVER LIES. It shows the actual planner tier, model and network state
   at that moment. A hardcoded value there is a build-breaking defect.

## Accuracy rule
We claim "fully on-device" and "offline". We NEVER claim "NPU". MediaPipe on Android runs
GPU/CPU, not Hexagon. The word NPU must not appear in any user-facing string, the README,
or the UI.

## Architecture
```
packages/core      types, Zod schemas, validator, ports (the boundary)   — portable
packages/agent     loop, guardrails, RunEvent stream                     — portable
packages/planner   Planner interface, prompt assembly, 3 implementations — portable
packages/report    self-contained HTML report generator                  — portable
adapters/web       DOM reader, DOM executor, settle detection            — swappable
adapters/android   stubs + porting notes                                 — swappable
apps/tiffin        the target food-delivery app (knows nothing of Origo)
apps/demo          split-pane page hosting Tiffin + the Origo console
```
Dependency rule: adapters and apps depend on packages. packages depend only on packages.
Nothing in packages/** may import from adapters/** or apps/**.

## Tech stack (do not relitigate)
- pnpm workspace monorepo, TypeScript strict + noUncheckedIndexedAccess
- Vite + React 18 + Tailwind + Zustand
- Zod for every schema at a trust boundary
- Vitest for tests
- WebLLM (WebGPU) for local inference — Tier 1, the default
- OpenRouter free tier for cloud inference — Tier 2, fallback
- Web Speech API for voice — free, browser-native
- Static build, free host (Netlify), COOP only — COEP breaks the model fetch (D2)

## Code standards
- Every fallible function returns Result<T,E>. No exceptions as control flow.
- No `any`. No silent catch that swallows. No untagged TODO (the lint rule fails it).
- Pure functions for anything testable: role mapping, pruning, prompt assembly.
- All UI renders from the RunEvent stream. No UI code reaches into the agent.

## Definition of done for any step
- `pnpm verify` passes (typecheck → lint → boundaries → test)
- Unit tests exist for the pure logic added and pass
- Manually verified, and you told me exactly what to run or click to verify it
- No step leaves the tree in a non-compiling state

## Hackathon scoring context (shapes priorities, not architecture)

There are TWO rubrics and they are not the same. Confusing them is how a team
optimises for the wrong round.

**RUBRIC 1 — SELECTION ROUND (this is what the submission is judged on, now):**
Problem clarity and relevance · Novelty and originality · AI-first thinking ·
iQOO device fit · Feasibility and impact. No published weights.
Practical consequence: the submission text must ARGUE these, not assume a reader
infers them. "iQOO device fit" in particular is not implicit — it has to be
stated: the runtime is the OS, the agent acts through the accessibility layer,
and there is no laptop version of this product. "AI-first thinking" is why the
on-device tier must be visible in the video and not merely described.

**RUBRIC 2 — ON-SITE ROUND (only if selected, 30 hours in Hyderabad):**
End product quality 30% · Novelty 20% · Creative device use 15% ·
Technical depth 15% · Phone-to-laptop bridge 10% · Demo 10%.
Practical consequence: voice and local inference are the primary paths, not
toggles. The HTML report must be exportable. Showing guardrails recovering is
worth more than hiding them.

**Continuation is sanctioned.** The organisers' FAQ: "If you submitted a
prototype at registration, you can keep building on it on-site." So hour zero on
site continues THIS repo. Nothing in docs/ may hedge about a clean-room rebuild.
OpenRouter credits are confirmed in writing for the event, which makes the
cloud-tier fallback funded rather than hypothetical.

## Working style
- State a 5-line plan before non-trivial code.
- One vertical slice at a time. Never scaffold empty files.
- You have terminal access: run commands, read output, fix failures yourself.
- Ask ONE question if genuinely ambiguous. Don't guess, don't build both options.
- Own the architecture. Push back if a request costs us later.
