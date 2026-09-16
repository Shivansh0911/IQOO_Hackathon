# The demo journey — what we chose, and what each choice becomes on Android

This document answers the fairest question a judge can ask: *"why did you demo on
the web?"*

The honest answer is strong on its own. Our thesis is about structured UI trees.
The DOM is one. The Android accessibility tree is another. We built the agent
against the abstraction, proved it works on the surface we could deploy, and
proved it ports by running the same agent on a second surface — a Chrome
extension against sites we do not own — before we ever had the phone.

---

## Every choice, and what it becomes

| | now (web + extension) | on Android |
|---|---|---|
| **Target app** | Tiffin — ours, deliberately awkward in three places: a clickable card whose text lives in child elements, an icon-only button named only by `aria-label`, and a list requiring a scroll. Plus the extension driving real public websites. | Real third-party apps, unmodified, granted by the user |
| **Tree source** | `document` traversal | `AccessibilityNodeInfo` from `getWindows()` |
| **Inference** | WebLLM, 1B–2B class, WebGPU | MediaPipe LLM Inference, Gemma 3 1B `.task` |
| **Voice** | Web Speech API | `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE` |
| **Evidence** | DOM snapshot, embedded in the report | `AccessibilityService.takeScreenshot` (API 30+) |
| **Report delivery** | browser download / clipboard | `FileProvider` share intent, across the bridge |
| **Destructive gate** | a sheet in the console | the same sheet in the Android shell |

## What does NOT change

This is the list that matters, because it is the list we do not have to rebuild
on site:

- the **seven action types** and their Zod schemas
- the **validation pipeline** — extract → schema → semantic → destructive policy
- **index addressing** — the model picks from a menu we just showed it
- **every guardrail** — step ceiling, retry limit, stuck detection, destructive
  gate, cancellation
- **prompt assembly**, including the Hinglish and Devanagari few-shots
- the **pruning policy** — the six drop reasons, the ranking, the cap, the
  reindex
- the **report format** and its generator
- the **RunEvent stream** and the console's reducer over it

`packages/agent/test/profile.test.ts` runs the entire agent through a platform
profile with no browser in it and reaches a Pass verdict. That test is the proof
of this section, and it fails immediately if anyone smuggles a DOM call into the
portable half.

---

## Why the hosted demo drives an app we built

Not a shortcut — a constraint we designed around, and we say so in the README
rather than letting a reader discover it:

- A deployed web page **cannot read the DOM of a cross-origin iframe**. Same-origin
  policy, and real sites send `X-Frame-Options` anyway. A shareable link
  physically cannot drive third-party websites.
- So a public prototype URL requires a same-origin target app. Tiffin is that.
- Tiffin is **Origo-blind, enforced by lint** (RULE B): it cannot import from
  `@origo/*`, cannot carry `data-origo-*` attributes, and cannot even mention
  Origo in a string. The build fails if it does. The agent finds its way purely
  by reading the DOM.
- The three awkward cases exist *because* a trivially easy fixture proves
  nothing.
- The `crossOriginLimited: true` capability flag on the web profile is where this
  limitation lives in code, not in a footnote.

The Chrome extension is the answer to the rest of the question: a content script
can read and act on any real site, so the same core, agent, planner and report
packages run unchanged against Wikipedia and MDN. Read-only goals only — search,
navigate, assert a heading exists. Never a login, never a form that sends data.

---

## The 30-hour plan, stated honestly

A judge is better served by an accurate split than by a claim of completeness,
and this doubles as our own schedule.

### Already built and tested (roughly 70% of the work)

- `packages/core` — the contract, seven actions, validation pipeline, ports,
  pruning policy
- `packages/agent` — the loop and every guardrail
- `packages/planner` — the interface, prompt assembly, cloud and scripted tiers
- `packages/report` — the self-contained HTML report
- the console UI and its RunEvent reducer
- `adapters/web` and `adapters/extension` — two working proofs of the seam
- `adapters/android` — the profile object, complete, type-checked and selectable

### Genuinely new on site (roughly 30%)

| work | why it is new | risk |
|---|---|---|
| `AccessibilityScreenReader` | Traversing `getWindows()` and computing the per-node flags against real Android widgets | **Medium.** The policy is already written and tested; only the flag computation is new. |
| `AccessibilityActionExecutor` | `ACTION_CLICK` walking to the nearest clickable ancestor, gesture-tap fallback, `ACTION_SET_TEXT` through a separate IME window | **High.** The IME window is the part we cannot rehearse on web. |
| MediaPipe integration | Loading a `.task` model and constraining decoding the way WebLLM is constrained | **Medium.** Well-documented path; the prompt and parser are unchanged. |
| The Android shell | A Compose UI rendering the same RunEvent stream | **Low.** It is a re-skin of a reducer that already exists. |
| Re-tuning pruning | Real apps are far denser than our clean React | **Medium.** The drop-reason histogram logging stays in precisely so this is a measurement, not a guess. |

### What we will re-measure rather than reuse

Every latency figure in our deck was measured in a browser on a laptop. None of
it transfers to a phone. Cold-start model load, per-step planning latency and
settle times are all re-measured on the device, and marked as phone numbers
wherever they appear.
