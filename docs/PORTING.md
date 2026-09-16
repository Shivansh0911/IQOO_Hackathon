# Porting — the hour-zero working document

Written before the event, to be followed by someone tired. Every row states what
changes in `packages/**`. The answer is **nothing**, everywhere, and
`packages/agent/test/profile.test.ts` is the test that proves it by running the
whole agent through a platform profile with no browser in it.

---

## The mapping table

| behaviour | web (now) | extension (now) | Android (on site) | changes in `packages/**` |
|---|---|---|---|---|
| **read tree** | `document` traversal from a root element | same, in a content script | `AccessibilityNodeInfo` traversal from **`getWindows()`** — plural, not just `rootInActiveWindow`, because the IME and dialogs are separate windows | none |
| **role mapping** | tag + ARIA role → `Role` | same | `className` → the same eight-role vocabulary | none — the vocabulary is in core, the mapper is in the adapter |
| **bounds** | `getBoundingClientRect`, relative to the app root | same | `getBoundsInScreen` | none |
| **clickable** | tag/role/handler/tabindex heuristic | same | `isClickable()` — no heuristic needed, the OS says so | none |
| **editable** | `input`/`textarea`/`contenteditable` | same | `isEditable()` | none |
| **scrollable** | computed `overflow-y` + scroll extent | same | `isScrollable()` | none |
| **text** | own text; aggregated for clickable/editable, aria-hidden excluded | same | `getText()`, falling back to `getContentDescription()`, with the same aggregation for clickable containers | none |
| **pruning** | the six drop reasons, area ranking, 40 cap, reindex | same | **identical** — the policy is `packages/core/prune.ts`, the adapter only supplies the flags | none |
| **Tap** | pointer + mouse + `click()` | same | `ACTION_CLICK`, **walking up to the nearest clickable ancestor**; gesture tap at the bounds centre when the node refuses | none |
| **TypeText** | prototype value setter + `input` event | same | focus, then `ACTION_SET_TEXT` with `ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE` | none |
| **Scroll** | `scrollBy` on the node | same | `ACTION_SCROLL_FORWARD` / `ACTION_SCROLL_BACKWARD` | none |
| **PressKey Back** | `history.back()` | same | `performGlobalAction(GLOBAL_ACTION_BACK)` — a real system back, not a history entry | none |
| **PressKey Home** | scroll the app to the top | same | `performGlobalAction(GLOBAL_ACTION_HOME)` | none |
| **settle** | poll snapshots, compare FNV-1a hash, 2500ms cap | same, 4000ms | poll snapshots + hash, 4000ms. **Never a fixed sleep** | none |
| **evidence** | the screen JSON, embedded in the report | same | `AccessibilityService.takeScreenshot` (API 30+); `MediaProjection` as a fallback below 30 | none |
| **report export** | Blob download / clipboard | same | `FileProvider` share intent → Office Kit over the bridge | none |
| **local inference** | WebLLM on WebGPU | not available in a side panel | **MediaPipe LLM Inference**, Gemma 3 1B `.task` | none — it is a `Planner` behind the same interface |
| **cloud inference** | OpenRouter free tier | same | OpenRouter with the event credits | none |
| **voice** | Web Speech API | same | `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE` | none |
| **cancellation** | `AbortSignal` | same | `AbortSignal` from a coroutine scope | none |

If any row ever needs a change in `packages/**`, the abstraction is wrong and
the fix belongs in the abstraction, not in a special case.

---

## Known divergences — the things that will bite

Not visible from the web, so they are written down rather than discovered.

### 1 · The IME is a separate accessibility window
`TypeText` may need to read a different window than the one being acted on. This
is why `PlatformCapabilities.multiWindow` exists and is `true` only on Android.
Traverse `getWindows()`, not `rootInActiveWindow`, or the keyboard is invisible
and typing silently does nothing.

### 2 · OriginOS kills background services aggressively
vivo/iQOO's power management will stop a long-running service. Required:
- a **foreground service** with a persistent notification, and
- a **battery-optimisation exemption** (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).

Write it as **runtime detection with a generic fallback** — attempt the
exemption, detect whether the service survived, and degrade honestly. **Never a
manufacturer string check.** `Build.MANUFACTURER == "vivo"` is the kind of code
that works on the demo phone and fails on the judge's.

### 3 · The accessibility permission needs a manual grant
It cannot be granted programmatically. On vivo it sits under a different settings
path from stock Android, and the confirm button has a **forced ~5-second delay**
before it becomes tappable. **Budget ten minutes at hour zero** and do it first,
because everything else is blocked behind it.

### 4 · Real apps are far denser than Tiffin — MEASURED, not guessed

`node scripts/measure-real-sites.mjs` runs the same reader against real public
websites at a phone viewport. Read-only; it clicks nothing.

| site | nodes before | after | kept | tokens | 40-cap binds |
|---|---|---|---|---|---|
| Wikipedia article | **13,115** | 40 | 0.3% | 725 | **yes** (+2) |
| Wikipedia search results | **9,466** | 40 | 0.4% | 636 | **yes** (+7) |
| example.com | 6 | 3 | 50% | 54 | no |
| *Tiffin, densest screen* | *180* | *17* | *9%* | *447* | *no* |

**Two findings, and they point opposite ways.**

GOOD: the token thesis SCALES. A 13,115-node page still serialises to 725
tokens, because the cap holds the ceiling. Density explodes; prompt size does
not. `offscreen` does the heavy lifting — 10,776 of 13,115 nodes on the
Wikipedia article — which is the rule behaving exactly as designed.

BAD: only **14 of the kept 40 are clickable**. The Wikipedia list opens with
"Site", "Main menu", "Personal tools", "Appearance" — page chrome rather than
controls.

**And here the first diagnosis was WRONG, which is worth writing down.** The
obvious explanation was that ranking by on-screen AREA promotes layout wrappers,
so interactive-first ranking was implemented and measured. It moved the number
by **0 to 2 nodes**. Wikipedia went 14 → 14 clickable; the search page went
9 → 11.

The reason is in the histogram: `overCap` is only **+2**, which means just **42
nodes survive the six drop rules in the first place**. The cap is choosing 40
out of 42 — there is almost nothing for ranking to do. The constraint is the
SURVIVOR POOL, not the ordering.

Why do so few survive, and why is so much of what survives non-interactive?
Wikipedia's chrome carries `aria-label`s, so it legitimately passes `no-signal`
(which only drops nodes with no text AND no description). That rule is correct in
general and too permissive here.

So the hour-zero work is **`no-signal`, not ranking**:
- interactive-first ranking is already shipped — it is strictly better, costs
  nothing, and will matter on an app screen where many nodes survive
- the lever to try first on a real app is tightening `no-signal` for
  non-interactive nodes whose only signal is a description that duplicates a
  nearby label, and checking the histogram before and after
- raising the cap is the last resort, not the first

One caveat on method: MDN could not be measured because its Content Security
Policy blocks an injected script. That is a limitation of the measurement
harness, not of the product — a real extension content script runs in an
isolated world and is not subject to the page's CSP.

### 5 · Every latency number we have is meaningless for the phone
All of them were measured in a browser on a laptop. Cold-start load, per-step
planning latency and settle times must be **re-measured on the device** and
marked as phone numbers wherever they appear. See the Gate 2 notes in the README
for how badly this varies even between two GPUs in the same laptop.

### 6 · WebGPU's lesson transfers: check which accelerator you actually got
On web, Chrome silently handed us the integrated GPU rather than the discrete
one, and the same 1B model went from usable to unusable. On Android, MediaPipe
will silently fall back from GPU to CPU. **Read the backend the runtime reports
and display it.** Never hardcode it, and never call it an NPU — MediaPipe runs
on GPU or CPU, not Hexagon.

---

## Hour-zero checklist

In order. Ordered so the riskiest unknown is resolved first, not so the easy
things feel productive.

```bash
# 1 · Install and confirm the build actually landed
adb devices                     # one device, "device" not "unauthorized"
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 2 · Grant accessibility BY HAND. Budget ten minutes.
adb shell am start -a android.settings.ACCESSIBILITY_SETTINGS
#    vivo: Settings > More settings > Accessibility > Downloaded apps
#    The confirm button is disabled for ~5 seconds. Wait for it.

# 3 · VERIFY THE SERVICE IS BOUND — do not trust the settings toggle
adb logcat -c && adb logcat | grep -i "OrigoAccessibility"
#    Expect onServiceConnected. If the toggle is on and this never logs,
#    the service died: check the foreground service and battery exemption.
adb shell dumpsys accessibility | grep -A5 "installed services"

# 4 · Dump a REAL app's tree and count it. The riskiest unknown, first.
adb shell uiautomator dump /sdcard/win.xml && adb pull /sdcard/win.xml
#    Count nodes. Compare against Tiffin (180 before, 17 after)
#    and the extension's real-site numbers.

# 5 · Retune pruning if the cap now binds
#    The histogram is logged on every snapshot. Look at which reason is
#    doing the work. Do NOT raise maxNodes first — find out what is
#    surviving that should not.

# 6 · Port the reader, then the executor
#    Reader first: you cannot debug an executor against a tree you cannot see.

# 7 · Re-measure everything
#    Cold-start load, per-step latency, settle time. Mark them as phone
#    numbers. Delete the laptop numbers from the deck.
```

### What to do first if you are behind schedule

Port the **reader** and run against the **cloud** planner. That gives a working
end-to-end demo on the phone with the smallest amount of new code, and MediaPipe
becomes an upgrade rather than a dependency. The status strip will say `cloud`,
which is true, and the on-device story stays honest as "the same interface, a
different planner".
