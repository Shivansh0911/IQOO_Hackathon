# If selected — the hour-zero document

Open this first. Written for two tired people under a 30-hour clock. Commands
and checklists. Nothing here is built yet; it is the plan.

**The one rule for the whole event:** when something is unknown, measure it
before you build on it. Every number in this repo came from a script, and twice
that habit stopped us shipping a claim that was false.

---

## 1 · Hour zero — the first 60 minutes

Ordered so the riskiest unknown resolves first, not so the easy things feel
productive.

```bash
# ── 0:00 · Install ─────────────────────────────────────────────────────────
adb devices
#   expect exactly one line ending "device". "unauthorized" = accept the
#   prompt on the phone. "offline" = replug the cable.

adb install -r app/build/outputs/apk/debug/app-debug.apk
#   expect "Success"

# ── 0:05 · Grant accessibility BY HAND. Budget ten minutes. ────────────────
adb shell am start -a android.settings.ACCESSIBILITY_SETTINGS
#   vivo/iQOO path: Settings > More settings > Accessibility > Downloaded apps
#                   > Origo Loop > toggle on
#   THE CONFIRM BUTTON IS DISABLED FOR ~5 SECONDS. Wait. Do not tap around.

# ── 0:15 · VERIFY THE SERVICE ACTUALLY BOUND ───────────────────────────────
#   Do NOT trust the settings toggle. It can read "on" with a dead service.
adb logcat -c
adb logcat | grep -i "OrigoAccessibility"
#   expect: onServiceConnected
#   if the toggle is on and this NEVER logs, the service died on start:
#     - check AndroidManifest has the accessibility service declaration
#     - check res/xml/accessibility_service_config.xml exists and parses
#     - go to step 0:25 (battery) and try again

adb shell dumpsys accessibility | grep -A5 "installed services"
#   expect our package listed under enabled services

# ── 0:25 · Battery-optimisation exemption ──────────────────────────────────
adb shell dumpsys deviceidle whitelist | grep origo
#   if absent, trigger the in-app request (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
#   and grant it on the phone. OriginOS will kill us without this.

# ── 0:35 · THE RISKIEST UNKNOWN: what does a real app's tree look like? ────
#   Open a real app on the phone (Settings, or any preinstalled list screen).
adb shell uiautomator dump /sdcard/win.xml && adb pull /sdcard/win.xml
#   count the nodes:
grep -o "<node" win.xml | wc -l
```

### Compare against our baselines

| source | nodes before | kept | clickable in kept |
|---|---|---|---|
| Tiffin, densest screen | 180 | 17 | 10 of 17 |
| Wikipedia article (web) | 13,115 | 40 | 14 of 40 |
| **the real app you just dumped** | ? | ? | ? |

Then read the drop-reason histogram our reader logs on every snapshot.

### THE DECISION RULE — do not skip this

> **If a real app's kept-40 contains fewer than 20 clickable nodes, STOP and fix
> ranking/pruning before writing a single line of executor code.**

An executor that acts perfectly on a node list the model cannot navigate is
wasted work. We learned this on the web: Wikipedia gave 14 clickable of 40, and
the obvious fix (interactive-first ranking, already shipped) moved it by 0–2
nodes because only 42 nodes survived the drop rules at all. **The lever is
`no-signal`, not the cap and not the ranking** — see D16.

Order to try, in this order:
1. Tighten `no-signal` — drop non-interactive nodes whose only signal is a
   description duplicating a nearby label. Check the histogram before/after.
2. Add an Android-specific drop: nodes whose className is a known layout
   container with no text and no action.
3. Raise `maxNodes` from 40 to 60 and measure the token cost. **Last resort** —
   it costs prompt budget on a model that is already struggling.

---

## 2 · What ports unchanged — the confidence section

This is what you tell a mentor who asks how far along you are.

| package | src lines | test lines | what it is |
|---|---|---|---|
| `packages/core` | 1,636 | 963 | contract, seven Zod actions, validation pipeline, pruning policy, ports, voice defences |
| `packages/agent` | 602 | 696 | the loop and every guardrail, RunEvent stream |
| `packages/planner` | 711 | 495 | Planner interface, pure prompt assembly, cloud + scripted tiers |
| `packages/report` | 492 | 241 | the self-contained HTML report |
| **total portable** | **3,441** | **2,395** | **296 tests** |

None of it contains a single line of web-specific code. That is enforced two
ways, not trusted: `packages/**` compiles with `lib: ES2022` and **no DOM**, so
`document` is a *type error* there, and RULE A fails the build on a web import.

```bash
# The proof. Runs the ENTIRE agent through a platform profile with no browser.
npx vitest run packages/agent/test/profile.test.ts
#   expect: 3 passed — including a full run reaching verdict Pass

# The boundaries, regression-tested against deliberately-violating fixtures
pnpm boundaries
#   expect: boundaries: 8/8 ok — RULES A, B and C are enforced
```

**Say this to a mentor:** "About 3,400 lines of the agent are done, tested and
platform-independent. We have already run the same core on two surfaces — a web
page and a Chrome extension. Android is the third, and only the adapter is new."

---

## 3 · What is genuinely new — the honest section

| work | hours | risk | why |
|---|---|---|---|
| `AndroidScreenReader` | **3** | med | Traverse `AccessibilityNodeInfo` from **`getWindows()`**, not just `rootInActiveWindow` — the IME and dialogs are separate windows. Compute the same per-node flags; the pruning POLICY is already written and tested |
| `AndroidActionExecutor` | **4** | **high** | `ACTION_CLICK` walking up to the nearest clickable ancestor, gesture-tap at bounds centre as fallback, `ACTION_SET_TEXT`, `ACTION_SCROLL_FORWARD/BACKWARD`, `performGlobalAction(GLOBAL_ACTION_BACK/HOME)`. The IME window is the part we could not rehearse on web |
| MediaPipe + Gemma 3 1B | **3** | med | Load a `.task` model, constrain decoding the way WebLLM is constrained (temp 0.1, stop at `}`, max 200 tokens). The prompt and parser do not change |
| Kotlin UI shell | **2.5** | low | Compose rendering the same `RunEvent` stream. It is a re-skin of a reducer that already exists |
| Wiring + first green run | **1.5** | med | Profile object, DI, the first end-to-end run |
| **total** | **14** | | **exactly the budget to evaluation round one — no slack** |

Because there is no slack: **if the executor is not working by hour 8, drop the
gesture-tap fallback and ship `ACTION_CLICK` only.** Note it as a limitation.

---

## 4 · The three things most likely to go wrong

Mitigations decided now, while we are calm.

### 4.1 · Gemma 3 1B repeats the Llama `node:0` failure

Llama-3.2-1B emitted node index 0 on 18 of 20 calls — it never read the element
list. Qwen2.5-1.5B fixed it (0% invalid). Gemma is untested and is a different
model family.

- **Detection:** run the 20-call protocol at **hour 4**, same harness, same five
  screens. `scripts/gate2-measure.mjs` is the pattern; port the harness, not the
  judgement.
- **Threshold:** invalid-output rate under 25% = proceed. Over = mitigate.
- **Mitigation:** switch to the **OpenRouter credits provided on site**. The
  CloudPlanner is already written, tested and wired. It is a one-line tier
  change and the status strip tells the truth about it automatically.
- **DECISION DEADLINE: hour 6.** Do not be at hour 10 still hoping. Write the
  time on a sticky note.

### 4.2 · Real app node counts break pruning

- **Detection:** the histogram at **hour 1** (section 1 above).
- **Mitigation:** the ordered list in section 1 — `no-signal` first, an
  Android layout-container rule second, raising the cap last.
- **Keep the histogram logging in.** It is how this stays a measurement.

### 4.3 · OriginOS kills the service mid-run

- **Detection:** a **10-minute idle test at hour 2**. Start the service, lock the
  phone, wait ten minutes, unlock, and check the service is still bound with the
  same logcat grep. Do it while doing something else.
- **Mitigation:** foreground service + persistent notification + battery
  exemption.
- **Write it as runtime detection with a generic fallback.** Attempt the
  exemption, detect whether the service survived, degrade honestly and say so in
  the UI. **NEVER a manufacturer string check.** `Build.MANUFACTURER == "vivo"`
  is the kind of code that works on the demo phone and fails on the judge's.

---

## 5 · The scoring gaps we know about

### Camera — 25% bucket, and we currently score zero on it

25% of the on-site score is camera, voice, on-device AI and Office Kit usage,
read off **device telemetry** rather than self-reporting. So it has to actually
happen on the device, not be described in the pitch.

We use **voice** (SpeechRecognizer) and **on-device AI** (MediaPipe). We do
**not** use the camera at all.

Two honest options, ~30 minutes each:

**Option A — QR to load a test goal.** Point the camera at a QR code printed on
paper; it decodes to a goal string, which then goes through the *same mandatory
review step* as a spoken transcript. `CameraX` + ML Kit barcode scanning.
- Honest: a QR is how you hand a device a long string without typing it.
- Fits the product: a QA team sticks test-case QRs on a wall.

**Option B — photograph a screen for a visual-diff assert.** `takeScreenshot`
already gives us evidence; a camera photo of a *second* device lets us assert
one screen matches another.
- Weaker: it duplicates something the accessibility tree already does better,
  and it invites the "so you do use pixels" question we do not want.

> **DEFAULT: Option A.** It is genuinely useful, it takes 30 minutes, it reuses
> the review step we already built, and it does not undercut the "structure, not
> pixels" thesis. Option B does undercut it.

Build it in the **H18–24** block, not before the first evaluation round.

### Office Kit — 10%, measured by counts and durations

Keep it connected **the whole event**. Things we genuinely do with it:

- **Push the HTML report to the laptop.** This is the phone-to-laptop bridge and
  it is already how the report is meant to travel. `FileProvider` share intent.
- **Mirror the phone for pair-debugging.** One of us drives the phone, the other
  reads logcat on the laptop screen.
- **Type long prompts with the laptop keyboard.** Prompt tuning on a phone
  keyboard is miserable and slow; this is a real use, not a box-tick.

Connect it at hour zero and leave it running. Durations count.

---

## 6 · Red Light / Green Light tactics

55% of build time is phone-only. **Our architecture makes that a non-event, and
we should say so to the jury** — the portable core is 3,400 tested lines that
needed no laptop to write and needs no laptop to change.

**The rule: compile during Green Light, iterate during Red Light.**

Gradle is the only laptop-dependent step, so **batch the builds**. Never sit in
Green Light doing something you could have done in Red Light.

| Red Light (phone only) | Green Light (laptop allowed) |
|---|---|
| prompt tuning — edit on the phone, test on the phone | `./gradlew assembleDebug` |
| running the 20-call protocol | `adb install` |
| on-device testing of real apps | logcat deep-dives |
| report styling (it is one HTML file) | git operations, pushing |
| **demo rehearsal, out loud, timed** | pulling reports over Office Kit |

Have a Gradle build queued the moment Green Light starts. Every time.

---

## 7 · The 30-hour plan

| hours | work | gate |
|---|---|---|
| **H0–4** | Reader + executor against **two** real apps | reader dumping a tree with ≥20 clickable in the kept set |
| **H4–8** | Gemma loaded, **20-call protocol**, tier decision | **hour 6: tier decided, no exceptions** |
| **H8–14** | Loop closed end to end on one real app | one full run to a verdict |
| **H14–18** | Voice + report. **FREEZE at H17 for evaluation round one** | a rehearsed 3-minute demo |
| **H18–24** | Guardrails on device, a second app flow, camera (QR) | the destructive gate firing on a real app |
| **H24–28** | Polish and rehearsal. **Rehearse out loud, timed, three times** | |
| **H28–30** | Buffer. Touch nothing that is working | |

**Sleep in shifts.** One of us must be coherent at pitch time — that matters
more than any feature built in the last four hours. Agree the shifts at hour
zero, in writing, before anyone is tired enough to argue.

**Freeze means freeze.** At H17 the demo path stops changing. Bugs found after
that get written on paper, not fixed.

---

## 8 · What we say to the jury

### The framing — do not soften it

> **PROVEN.** Reading structure instead of pixels makes a screen **438 tokens**
> instead of about 1,500. Measured with a real tokenizer. Still only **725 tokens
> on a 13,115-node page** — it does not grow with density. You can check it in
> the debug panel.
>
> **PROVEN.** The agent, the validator and every guardrail work. We can show you
> that under a model that was **not good enough** — 15 invalid actions in 20
> calls, the validator caught **every one**, and nothing wrong reached the app.
>
> **OPEN.** Which small model reliably completes a multi-step task. Llama-3.2-1B
> does not. Qwen2.5-1.5B produces legal actions every time but does not yet
> finish multi-step goals. Gemma 3 1B on this phone is what we measured here
> today, and here is the number.

### If asked to watch a full on-device task and it is not working yet

**Do not improvise and do not apologise twice.** Say this:

> "Not reliably yet — the model gets each action right and doesn't know when to
> stop. Let me show you something better."

Then open the **Guardrails panel**. Fifteen real rejections, the raw model text,
the exact validator error, the retry. Then:

> "Every team here will show you their happy path. This is what ours does when
> the model is wrong. Nothing reached the app."

That is the strongest thirty seconds we have. It is stronger than a working demo
would be, because it is the thing nobody else can show.

### The three questions to have answers ready for

1. **"Why not just use a screenshot and a big model?"** — 438 versus 1,500
   tokens, and the big model does not fit on the phone. The whole product is
   that number.
2. **"Would this work on an app you didn't build?"** — the Chrome extension runs
   the same unchanged core on real websites, and we measured the reader on a
   13,115-node Wikipedia page before we had the phone. Then show the real-site
   numbers.
3. **"What breaks?"** — answer it straight: the model's stopping behaviour, and
   pruning on very dense apps. Both measured, both written down, both with a
   mitigation already chosen. A team that knows what breaks is a team that
   measured.
