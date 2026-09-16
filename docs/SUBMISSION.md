# Phase 1 submission — answers ready to paste

iQOO Hackathon 2026 · Hyderabad City Battle · Developer Tools · Students
Deadline: 22 September 2026, 23:59 IST

Everything below is backed by something in this repository, so nothing has to be
written from memory at 11pm on the 22nd. Placeholders marked
`[[ Tushya to confirm ]]` / `[[ Shivansh to confirm ]]` are the only parts that
still need a human decision.

---

## 1 · Project title and description

**Origo Loop — tell your phone what to test, and it tests itself.**

> Origo Loop is an on-device AI agent that operates any app from a spoken
> instruction in English, Hindi or Hinglish. Instead of screenshotting the screen
> and sending the image to a cloud vision model, it reads the app's structure —
> the accessibility tree on Android, the DOM on the web — and serialises it to
> compact JSON. One screen costs about 438 tokens instead of a screenshot's
> ~1,500, and at that size a 1-billion-parameter model is enough to plan the next
> action. So the whole agent fits on the phone: offline, private, instant. It
> taps, types, scrolls and verifies, then produces a test report with per-step
> evidence and a pass/fail verdict.

*(96 words.)*

---

## 2 · What makes the idea and the team stand out

> Every agent that operates a screen sends a screenshot to a large cloud model.
> We read the structured UI tree instead. Measured with a real BPE tokenizer:
> 438 tokens per screen on our test app, and still only 725 on a 13,000-node
> Wikipedia article — roughly 3.4× smaller than a screenshot, and it does not
> grow with page density. That is what makes a 1.5B model sufficient, and a
> 1.5B model is what fits on the phone.
>
> The prototype is deployed and a judge can drive it themselves rather than watch
> a video. It is not a mockup: the agent reads the live DOM, plans one action at
> a time, validates every action against the screen it was shown before executing
> it, and refuses anything destructive without asking. You give it a goal in
> plain speech — it works out the flow itself; nobody records a script first.
>
> A Chrome extension runs the same agent, unchanged, against real third-party
> websites, which is how we know the Android port is a swap and not a rewrite.

*(148 words.)*

---

## 3 · Presentation deck

Separate from this repository. Use the measured numbers from `README.md`, not
estimates.

## 4 · Live video walkthrough

Shot list in [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md), derived from the four scripted
runs in the demo console.

## 5 · Prototype URL

- **Live demo:** `[[ deploy with docs/DEPLOY.md — one `vercel --prod` — then paste here ]]`
- **Repository:** https://github.com/Shivansh0911/IQOO_Hackathon

Not optional for us. It is the single biggest thing separating this submission
from a deck.

---

## 6 · Team's Android proficiency

`[[ Tushya to confirm ]]` `[[ Shivansh to confirm ]]`

Suggested honest framing — adjust to what is actually true, do not inflate it.
Overclaiming here is checkable and worse than a modest true answer:

> Both of us are comfortable in Kotlin and have built and shipped Android apps as
> coursework and personal projects. Neither of us has shipped a production
> AccessibilityService before; we have read the API surface closely and mapped
> every call we will need — AccessibilityNodeInfo traversal from getWindows(),
> ACTION_CLICK, ACTION_SET_TEXT, ACTION_SCROLL_FORWARD, performGlobalAction and
> takeScreenshot — into a porting document written before the event
> (`docs/PORTING.md`), including the OEM-specific problems we expect on OriginOS.
> We have deliberately built the web and extension versions first so that the
> Android work on site is two adapter classes against interfaces that already
> exist and are already tested.

## 7 · Team's LLM / AI proficiency

`[[ Tushya to confirm ]]` `[[ Shivansh to confirm ]]`

> We have built with hosted LLM APIs and with local inference. For this project
> the relevant work is visible in the repository: a constrained single-action
> JSON protocol with a Zod-validated schema, a four-stage validation pipeline
> that never executes unvalidated model output, prompt assembly as a pure,
> unit-tested function with measured token budgets, and three interchangeable
> inference tiers behind one interface (WebLLM on WebGPU, OpenRouter's free tier,
> and a scripted tier for offline development). We have not trained or fine-tuned
> a model, and we do not claim to have.

## 8 · Prior build or hackathon experience

`[[ Tushya to confirm ]]` `[[ Shivansh to confirm ]]`

> `[[ list real hackathons, placements and shipped projects, with dates ]]`
>
> For this build specifically, the commit history is the evidence: the repository
> was built step by step with the architectural boundaries enforced by lint from
> the first commit, and every measured claim in our deck has a script in the
> repository that reproduces it (`pnpm measure`).

---

## Facts sheet — for filling any form field quickly

| | |
|---|---|
| Team | Tushya Jain (lead), Shivansh Shekher Ojha |
| Institution | BITS Pilani, Hyderabad Campus |
| Track | Developer Tools · Students |
| Tokens per screen | 438 mean, 580 worst, 374 best (real BPE tokenizer, 5 screens) |
| On a real 13,115-node page | 725 tokens — the cap holds the ceiling |
| On-device invalid-output rate | 0% over 20 calls (Qwen2.5-1.5B); 75% (Llama-3.2-1B) |
| Offline | verified: model loaded, network cut, 10/10 calls still worked |
| vs a screenshot | ~3.4× smaller than ~1,500 tokens |
| Pruning | 180 → 17 nodes on the densest screen (9% kept) |
| Guardrails | 25-step ceiling · 2-retry limit · stuck detection · destructive gate · cancellation |
| Cost to run | Zero. No paid API, no paid hosting, no key needed by a visitor. |
| Tests | 286, including the whole agent loop against a platform with no browser in it |

## What we do NOT claim

Stated here so nobody on the team accidentally overstates it in an interview:

- **Never "NPU".** MediaPipe LLM Inference on Android runs on GPU or CPU, not the
  Hexagon NPU. The word does not appear in our UI, README or deck.
- **Tiffin is a controlled test fixture**, not a third-party app. It is ours, and
  we say so. A deployed web page physically cannot read a cross-origin iframe, so
  a shareable link cannot drive someone else's site — that is what the Chrome
  extension is for.
- **Latency numbers measured in a browser do not transfer to a phone.** They will
  be re-measured on the device and re-stated.
- We have **not** trained or fine-tuned a model.
