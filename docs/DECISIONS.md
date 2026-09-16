# Decisions

One line per architectural decision, with the reason, so nothing gets silently
relitigated at hour 22.

---

**D1 · We claim "on-device" and "offline". We never claim "NPU".**
MediaPipe LLM Inference on Android runs on GPU or CPU, not the Hexagon NPU. The
word must not appear in any user-facing string, the README, or the UI. Any
backend readout shows the value the runtime actually reports; a hardcoded label
there is a build-breaking defect, not a cosmetic one. A test asserts the report
never contains it.

**D2 · Node addressing by assigned index, never coordinates or selectors.**
The model picks from a menu we just showed it. A hallucinated index is provably
out of range, so the worst outcome of a hallucination is a retry, never a wrong
tap. This is what makes "never execute unvalidated output" enforceable rather
than aspirational. Coordinates exist internally only, to draw the highlight ring
and annotate report evidence.

**D3 · Seven action types including Assert, with three verdict constraints.**
Assert is evaluated against the POST-action screen state and recorded as a
first-class outcome. `Finish(Pass)` with zero passed Asserts is downgraded to
Blocked — a run that verified nothing is a walkthrough, not a test.
`Finish(Pass)` after a FAILED Assert is downgraded to Fail, not Blocked, because
"we checked and it was wrong" is the informative answer and small models will
happily assert, watch it fail, and finish Pass anyway. All three live in the
validator, so verdict policy exists in exactly one place.

**D4 · Free tier only, and WebLLM is the default.**
No paid API, no paid hosting, and no key required for a stranger to use the
deployed link. WebLLM is the default tier rather than a fallback because it is
what makes the offline claim literally true in the demo instead of merely
promised. Without a key the app still runs: the scripted tier drives the real
loop and the status strip says "mock" throughout.

**D5 · The token claim is the measured 438, not an estimate.**
`pnpm measure` reads real Tiffin in real Chromium with a real BPE tokenizer
across five screens: **438 tokens per screen on average, 580 worst, 374 best —
roughly 3.4× smaller than a ~1,500-token screenshot.**
Two corrections got us there, both made by changing the claim rather than the
measurement:
- The estimator was a guessed 3.5 characters per token and understated the truth
  by ~17%. Recalibrated to a measured 2.8, which is the honest direction.
- The token-budget tests asserted a wished-for ≤300 and failed. They were
  rewritten around the measured range, not relaxed to pass.
An earlier figure of 415 predates D8; the 438 supersedes it. Never round it down
to 400 to make it prettier — a judge can open the debug panel and check, which is
exactly why the smaller claim is the stronger one.

**D6 · Hand-written CSS, not Tailwind.**
A deviation from the agreed stack, flagged when it was made. The console needs
1px hairlines, a 4px radius ceiling and monospace on every machine-written
string; Tiffin needs to look like a different team built it. Tailwind fights both
intentions, adds a build dependency, and grows a bundle the brief wants small.
Everything else in the stack is unchanged.

**D7 · The planner returns raw text; the agent validates.**
The brief specified `Result<Action, PlanError>`. If each planner returned a
parsed Action, three implementations would each parse and validate, and "never
execute unvalidated model output" would become a convention instead of a
guarantee. There is one validator, and the agent owns it because only the agent
holds the ScreenState the action must be checked against.

**D8 · Interactive nodes get a 100-character text budget; plain text nodes keep 60.**
Found by reading a real generated report, not by a test: a deliberate-failure run
failed with "node 11 has no number to compare" because the restaurant card's
rating had been truncated away. The verdict was right by accident and wrong in
its reasoning, which is the worst kind of passing test. Interactive nodes
AGGREGATE several fields — name, cuisine, rating, time, price in one control —
so they need the room. Measured cost: mean screen 415 → 438 tokens.

**D9 · LocalPlanner lives in an adapter, not in packages/planner.**
WebLLM needs `navigator.gpu`. `packages/**` is machine-forbidden from containing
web code by RULE A, and weakening that lint rule to fit one file would undermine
the portability claim the whole repository rests on. It lives in `adapters/webllm`
behind the same `Planner` interface — which is what the interface is for. On
Android, MediaPipe gets its own adapter and this package still does not change.

**D10 · An Assert does not count toward stuck detection.**
Two Asserts in a row read the same screen twice. Counting that as being stuck
would terminate perfectly good runs that verify two things — an observation is
not a failed attempt to move the screen.

**D12 · Qwen2.5-1.5B is the on-device model, chosen by measurement.**
Llama 3.2 1B was the first choice because 1B is exactly the class we will run on
the phone. It failed on the only thing that mattered: across 20 calls against
real screens it emitted node index 0 on 18 of them — reading the goal and
writing a plausible action without ever attending to the element list. Three
measured prompt fixes took it from 87% to 75% invalid and no further.

| model | calls | valid | invalid rate | mean latency |
|---|---|---|---|---|
| Llama-3.2-1B-Instruct q4f16 | 20 | 5 | **75%** | 2.3s |
| Qwen2.5-1.5B-Instruct q4f16 | 20 | 20 | **0%** | 4.0s |

Qwen is still 1B–2B, so the phone story survives, and it genuinely attends: the
indices it chose were 12, 13, 14, 17, 22 and 23, each appropriate to its screen.
Two prompt changes went in alongside the swap, both following from the diagnosis
that this was a SELECTION problem and not a context-length one: `node` is now the
first key in every targeted action shape, and the goal sits immediately before
the element list with nothing between them.

Caveat recorded because 0% invalid is not 100% correct: on the search screen
Qwen sometimes taps a restaurant card rather than typing into the search field.
Legal, plausible, and not what we wanted. The validator checks legality, not
goal-appropriateness. Quote the invalid-output rate; never call it accuracy.

**D13 · The local tier advertises itself only once WARM.**
WebGPU being present is not the same as the local tier being usable — the first
call has to download ~1.1GB. The registry used to auto-select local, and the
console then sat on a blinking "planning" caret for minutes with no progress
anywhere near the run. On conference wifi a judge would conclude it was broken.
Loading is now an explicit act with real progress, and automatic selection
prefers local from then on.

**D14 · No service worker, and the offline claim is scoped to match.**
VERIFIED: load the model, cut the network, and the full loop keeps working —
10/10 planning calls with `navigator.onLine === false`. NOT TRUE: a cold start
with no network, because the lazily-imported WebLLM chunk has nothing caching it.
A service worker would fix that, and a buggy service worker is a classic way to
brick a deployed site with a stale cache. Days before a deadline, with no way to
re-verify on the real host, the honest scope is the better trade. The claim is
therefore "works with the network off once the model is loaded", never "works
offline" unqualified.

**D15 · The termination-rule prompt experiment was reverted, because it measurably
made things worse.**
The on-device model produced legal actions but looped Asserts without ever
emitting Finish. Three prompt changes were tried, exactly as specified: an
explicit termination rule, the assert outcome SHOUTED in history, and an
Assert→Finish few-shot with history. Result:

| prompt | single-shot invalid rate |
|---|---|
| before | **0%** (20/20 valid) |
| + termination rules + Assert→Finish few-shot | 20%, then **40%** |
| after revert | **0%** restored |

Neither did it fix the finish gap: two full console runs still ended Blocked.
The system prompt had grown from ~960 to ~1240 tokens, and a 1.5B model's
instruction-following degraded as it grew — more rules bought less adherence.
Only the zero-cost part was kept: history now renders `-> PASSED` / `-> FAILED`
instead of `-> assert-pass`, which adds nothing to the system prompt.

The finding stands as OPEN: **prompt engineering did not close the finish gap on
a 1.5B model, and trying harder made the working number worse.**

**D16 · Interactive-first ranking is shipped, and it does NOT fix the real-site
clickable ratio.**
Ranking interactive nodes above non-interactive ones before the 40-cap is
correct, tested and free — a big button should outrank a bigger wrapper. But it
was implemented to fix Wikipedia's 14-of-40 clickable ratio and it moved that
number by 0 to 2 nodes. The histogram explains it: `overCap` is +2, so only 42
nodes survive the drop rules and the cap is choosing 40 of 42. The constraint is
the SURVIVOR POOL, not the ordering — Wikipedia's chrome carries aria-labels and
legitimately passes `no-signal`. Tiffin is unaffected either way, because the cap
never binds there: 438/580/374 tokens unchanged.

**D11 · Tiffin is named a controlled test fixture, in the README, by us.**
A deployed page cannot read a cross-origin iframe, so a shareable link
physically cannot drive third-party sites. Rather than let a reader discover that
and conclude we hid it, we state it and answer it: the Chrome extension runs the
same unchanged core against sites we do not own.
