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

**D11 · Tiffin is named a controlled test fixture, in the README, by us.**
A deployed page cannot read a cross-origin iframe, so a shareable link
physically cannot drive third-party sites. Rather than let a reader discover that
and conclude we hid it, we state it and answer it: the Chrome extension runs the
same unchanged core against sites we do not own.
