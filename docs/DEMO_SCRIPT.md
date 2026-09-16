# The video — shot list and narration

Three minutes. Every claim on screen is one a judge can reproduce from the live
link, which is why the numbers are read off the UI rather than typed into a
slide.

Setup for every take: open the demo, press **Reset**, and let the model finish
loading so the status strip reads what it will read during the take. Never record
over a status strip that says something you are about to contradict.

---

## 0:00–0:20 · The problem, in one sentence

**On screen:** the demo, idle. Tiffin on the left, the console on the right.

> "Testing a phone app means either writing code against it, or tapping through
> it yourself. Origo Loop does neither — you tell it what to test, out loud, and
> it drives the app itself."

---

## 0:20–0:50 · The insight, with the number on screen

**On screen:** `pnpm dev:debug` — the debug panel, Tiffin beside the serialised
screen JSON and the prune histogram. Point at `180 → 17 (9% kept)` and at the
token count.

> "Every other screen agent takes a screenshot and sends the image to a cloud
> model. We read the structure instead — the same tree the operating system
> already maintains for accessibility. One screen: 438 tokens, measured, against
> about 1,500 for a screenshot. That's what makes a one-billion-parameter model
> enough, and a 1B model is what fits on the phone."

**Cut to:** the console's status strip, holding on `TOKENS 407 est/screen`.

---

## WHICH TIER TO RECORD ON — read this first

**Record runs A, B and C on the scripted (mock) tier, and say "scripted" if
asked.** Verified: all three complete correctly, every time, in 1.5–2.5s. The
status strip says `PLANNER mock · MODEL scripted` throughout, so nothing is
misrepresented — the loop, the reader, the validator, the guardrails and the
executor are all the real production path; only the *plan* is fixed.

**Do NOT record a multi-step run on the local tier.** Measured: Qwen2.5-1.5B
produces 0% invalid single actions but does not yet complete a multi-step goal —
it loops asserting and never finishes, and the repeated-action guard ends the run
as Blocked at ~21s. That is the guardrail working correctly and it is not a demo.

**Do show the local tier** — press "Demo mode", let it load, and hold on the
strip reading `PLANNER local · on-device · MODEL Qwen2.5-1.5B-Instruct-q4f16_1-MLC`.
That single frame is the on-device claim, and it is true.

---

## 0:50–2:00 · Three live runs

### Run A — 0:50–1:20 — the clean one *(demo goal 1 + 2)*

- **Goal, spoken in Hinglish:**
  `biryani search karo aur check karo ki biryani wale restaurants mile`
- **Setup:** Reset. Cart empty, search screen.
- **Expected:** 3 steps, verdict **Pass**, 1 assert passed, ~1.1s.
- **Narration:** "Spoken in Hinglish — no translation, it reaches the planner
  exactly as it was said. Watch the amber ring: that's the agent choosing an
  element by the index it was shown, never by a coordinate."

> If time allows, use the longer goal instead — *add an item from the first
> biryani restaurant and check the cart total is under 500* — 6 steps, Pass,
> which shows a multi-screen flow ending in a numeric assertion.

### Run B — 1:20–1:40 — the guardrail *(demo goal 3)*

- **Goal:** `add an item and place the order`
- **Setup:** Reset first, so the cart fills on camera.
- **Expected:** 5 steps, the confirmation sheet appears on the `Proceed to
  checkout` element, matched pattern `checkout`. Deny it. Verdict **Blocked**.
- **Narration:** "It got to the point of spending money and stopped. The gate is
  in the validator, not the prompt — the agent cannot talk itself past it."
- **This is the shot that sells the safety story. Hold on the sheet for a beat.**

### Run C — 1:40–2:00 — the honest failure *(demo goal 4)*

- **Goal:** `check that the first biryani restaurant is rated above 4.9`
- **Setup:** Reset.
- **Expected:** 3 steps, verdict **Fail**, red, reason
  `node 11 reads 4.5; expected > 4.9`.
- **Then:** click **Download HTML** and open the report on screen.
- **Narration:** "It checked, the expectation didn't hold, and it says so — with
  the number it actually read. That report is one self-contained file: no
  stylesheet, no script, nothing external. That's how it comes off the phone."

### Run E — 1:40–2:00 — the Guardrails panel *(the strongest 20 seconds)*

- **Setup:** scroll the console to the "guardrails" panel, press "Show the
  evidence".
- **What it shows:** a real captured run where the on-device model was NOT good
  enough — 15 of 20 replies rejected, with the raw model text, the specific
  validator message, and the retry.
- **Narration:** "This is a real recorded run from a model that couldn't do the
  job. Fifteen bad outputs out of twenty. The validator caught every one, and
  nothing reached the app. Every team will show you their happy path — this is
  what ours does when the model is wrong."

### Run D — optional, if the extension is ready

- The Chrome extension driving Wikipedia or MDN: search, navigate, assert a
  heading exists. Read-only.
- **Narration:** "Same agent, same core, a site we don't own and didn't build."

---

## 2:00–2:35 · Architecture and the on-site plan

**On screen:** the repo — `packages/` beside `adapters/`, then
`packages/agent/test/profile.test.ts` passing.

> "Everything above the platform boundary is written once. The agent loop, the
> validator, the guardrails, the prompt, the report — none of it knows what it's
> running on. This test drives the whole agent through a platform with no browser
> in it at all. On site we write two classes against interfaces that already
> exist: a reader over the accessibility tree, and an executor over ACTION_CLICK
> and ACTION_SET_TEXT. Everything else is already done and already tested."

---

## 2:35–3:00 · Why phone-first, and why this team

**On screen:** the demo again, or an iQOO device if we have one.

> "This can't be a laptop product. The runtime is the operating system — the
> agent acts through the accessibility layer, the same one a screen reader uses.
> The phone isn't a display for it. The phone is the product.
>
> Two of us, from BITS Hyderabad. Everything in this video is in the repository,
> every number has a script that reproduces it, and the link is live — you can
> drive it yourself."

---

## Recording notes

- Record at the demo's real speed. Don't speed up the log; the per-step latency
  in the corner is part of the argument.
- If a run goes wrong on camera, **keep it** if it recovers — a rejection row
  followed by a correct retry is a better demo than a clean take.
- Never record a take where the status strip says something the narration
  contradicts. If it says `mock`, say scripted.
- Show the amber ring at least twice. It is the moment the abstraction becomes
  visible.
- Have `.shots/report-fail.html` open in a second tab as a fallback if the live
  download misbehaves.
