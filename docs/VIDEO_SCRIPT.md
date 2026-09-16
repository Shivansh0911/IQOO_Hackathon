# The video — script and recording guide

**Timed to the clips that actually exist**, not to a plan. Measured durations:

| clip | duration | what it holds |
|---|---|---|
| `clip-01-goal.webm` | **22.3s** | Hinglish goal typed, run completes Pass, then a walk down each step |
| `clip-02-tokens.webm` | **23.0s** | the cart run, then a hold on the status strip's token count, then the log |
| `clip-03-guardrail.webm` | **12.3s** | the confirmation sheet, held, then Deny → Blocked |
| `clip-04-fail.webm` | **13.9s** | the red verdict, then a hold on the failing assert line |
| `clip-05-rejects.webm` | **23.1s** | six real rejections stepped through, raw model text and validator error |
| **total footage** | **94.6s** | |

Two slots are yours to record: the opener and the close. Everything between is
footage that exists.

> **One deviation from the original plan, and why.** The brief allotted 0:50–1:50
> — a full minute — to clip-01. The run finishes in about two seconds on the
> scripted tier, so there is no minute of footage to give, and padding it would
> have meant slowing the video down and pretending the product is slower than it
> is. The time went to **safety instead: clip-03 and clip-05 now get 48 seconds
> together**, which is where the differentiator is anyway.

---

## The script

Every number spoken here is one we measured. Durations in the right column are
targets — if you overrun a line, cut a sentence, don't rush it.

### 0:00 – 0:18 · THE PROBLEM — *you on camera, or over deck slide 2*

| # | narration | secs |
|---|---|---|
| 1 | "Testing a phone app still needs a laptop." | 2 |
| 2 | "You either write code against it, or you tap through it yourself." | 4 |
| 3 | "And the AI option means sending your screen to someone else's cloud." | 4 |
| 4 | "We built the other thing. You tell the phone what to test. It tests itself." | 5 |
| 5 | *(beat — let it land)* | 3 |

### 0:18 – 0:45 · THE INSIGHT — *over `clip-02-tokens.webm`*

Lead with the number. It is the whole argument.

| # | narration | secs |
|---|---|---|
| 1 | "Every other screen agent takes a screenshot and sends the picture to a big model." | 4 |
| 2 | "We don't read pixels. We read structure." | 3 |
| 3 | "The operating system already keeps a tree of every element on screen — that's what screen readers use." | 5 |
| 4 | "We serialise that tree to compact JSON." | 3 |
| 5 | "One screen: four hundred and thirty-eight tokens. A screenshot is about fifteen hundred." | 5 |
| 6 | "That's measured, with a real tokenizer. The count is on screen, top right, live." | 4 |
| 7 | "And it doesn't grow. A thirteen-thousand-node Wikipedia page still came out at seven twenty-five." | 5 |

> **Cut point:** clip-02 is 23s; this narration is 29s. Hold the last frame of
> clip-02 for ~6s, or let line 7 run over the first seconds of clip-01.

### 0:45 – 1:10 · IT WORKS — *`clip-01-goal.webm`, in full*

Describe the **decisions**, not the UI.

| # | narration | secs |
|---|---|---|
| 1 | "Here's a goal, typed in Hinglish. No translation — it reaches the model exactly as written." | 5 |
| 2 | "Now it reads the screen. Seventeen elements survive out of a hundred and eighty." | 4 |
| 3 | "It picks one by number. Not a coordinate, not a selector — a number from a list we just showed it." | 5 |
| 4 | "It types the search. Reads the screen again. Checks the results actually say biryani." | 5 |
| 5 | "Then it stops and says Pass, with the value it read." | 4 |

### 1:10 – 1:58 · IT IS SAFE — *`clip-03-guardrail.webm` then `clip-05-rejects.webm`*

**This is the differentiator. Do not rush it.**

| # | narration | secs | clip |
|---|---|---|---|
| 1 | "Because it picks from a numbered list, a made-up number is provably invalid." | 4 | 03 |
| 2 | "So nothing unchecked ever reaches the app." | 3 | 03 |
| 3 | "Watch. It got as far as spending money — and stopped to ask." | 5 | 03 |
| 4 | "Deny. Run over. Nothing was ordered." | 4 | 03 |
| 5 | *(cut to clip-05)* "Now the part nobody else will show you." | 3 | 05 |
| 6 | "This is a real recorded run where the on-device model was not good enough." | 5 | 05 |
| 7 | "Fifteen bad outputs out of twenty calls." | 3 | 05 |
| 8 | "That's the raw text it produced. That's the exact error the validator gave back." | 5 | 05 |
| 9 | "Every single one was caught. Nothing reached the app." | 4 | 05 |
| 10 | "Every team here will show you their happy path. This is what ours does when the model is wrong." | 6 | 05 |
| 11 | *(hold, silent)* | 3 | 05 |

### 1:58 – 2:30 · IT PORTS — *architecture slide, or the repo tree on screen*

| # | narration | secs |
|---|---|---|
| 1 | "The DOM and Android's accessibility tree are the same kind of thing." | 4 |
| 2 | "A tree of elements, with roles, text, bounds and flags." | 3 |
| 3 | "So the agent was built against an abstraction, not against a browser." | 4 |
| 4 | "Thirty-four hundred lines of it — the loop, the validator, the guardrails, the report — have zero web code." | 6 |
| 5 | "That's not a promise. It's machine-enforced: a lint rule and a compiler setting both fail the build." | 6 |
| 6 | "The same core already runs on two surfaces: this page, and a Chrome extension on real websites." | 5 |
| 7 | "Android is the third. The adapter is the only new part." | 4 |

### 2:30 – 3:00 · WHO, AND WHAT IS OPEN — *you on camera*

**Do not cut the last two lines.** Stating a limitation reads as confidence, and
it answers the question a judge was about to ask.

| # | narration | secs |
|---|---|---|
| 1 | "We're Tushya Jain and Shivansh Ojha, from BITS Pilani Hyderabad." | 4 |
| 2 | "Everything in this video is in the repository. Every number has a script that reproduces it." | 5 |
| 3 | "And one thing is still open." | 3 |
| 4 | "Which small model reliably finishes a multi-step task." | 4 |
| 5 | "Llama one-B couldn't pick an element at all. Qwen one-point-five-B picks correctly every time — but doesn't reliably know when to stop." | 8 |
| 6 | "We know that because we measured it. The architecture is done. The model is the gap." | 6 |

---

## Words to avoid — read this before you record

| never say | say instead | why |
|---|---|---|
| "fully offline" | "works with the network off once the model has loaded" | a cold start with no network fails — no service worker |
| "NPU" | "on-device" | MediaPipe runs on GPU or CPU, not Hexagon |
| "accuracy" / "100% accurate" | "invalid-output rate" | 0% invalid means legal-for-the-screen, not correct |
| "about four hundred tokens" | "four hundred and thirty-eight" | the exact number is the credible one |
| "it always works" | nothing — just show it | the finish gap is real and a judge will find it |

---

## Recording guide

### 1 · Capture the clips

```bash
# Against the deployed site — this is the one to use for the real video
node scripts/record-demo.mjs https://your-site.netlify.app

# Or against the local production build, to rehearse
npx vite build apps/demo
node scripts/record-demo.mjs
```

Clips land in `.shots/video/clip-XX-name/clip-XX-name.webm`. The script prints
each duration; re-run it until all five say `ok`. It is deterministic — the
scripted tier does the same thing every time.

### 2 · Assemble, in this order

```
[you: opener]            0:00 → 0:18
clip-02-tokens.webm      0:18 → 0:41   (hold last frame to 0:45)
clip-01-goal.webm        0:45 → 1:07   (trim ~1s of lead-in)
clip-03-guardrail.webm   1:10 → 1:22
clip-05-rejects.webm     1:22 → 1:45   (hold last frame to 1:58)
[architecture slide]     1:58 → 2:30
[you: close]             2:30 → 3:00
```

Cut points: trim the first ~1s of each clip (the page-load flash) and the last
~0.5s. Nothing else needs cutting.

### 3 · What you record yourself — one take each

- **0:00–0:18 opener.** Face to camera or voice over deck slide 2. Six lines.
- **2:30–3:00 close.** Face to camera. Six lines. Ends on the open problem.

Both are short enough to do in one take. If you fluff a word, restart rather
than splice — a visible splice in the closing line undercuts it.

### 4 · Free tool for assembly

**Shotcut** (shotcut.org, free, Windows, no watermark, no account).

1. Download and install. Open it.
2. **File → Open File** and select all five `.webm` clips at once.
3. **Timeline → + (Append)** each clip in the order above.
4. Drag clip edges inward to trim the load flash.
5. Record your voiceover: **File → Open Other → Audio/Video Device**, or record
   in Windows Voice Recorder and drag the file onto a second audio track.
6. Mute the video tracks (the clips have no useful audio): click the speaker
   icon on each video track.
7. **File → Export → YouTube preset** → Export File. ~2 minutes to encode.

*(Alternatives: CapCut Desktop if you want auto-captions; DaVinci Resolve if you
already know it. Do not use anything that adds a watermark.)*

### 5 · Pre-record checklist

```
[ ] Browser zoom exactly 100%  (Ctrl+0)
[ ] Notifications OFF          (Windows: Focus Assist → Alarms only)
[ ] Bookmarks bar hidden       (Ctrl+Shift+B)
[ ] Clean browser profile — no extensions visible, no other tabs
[ ] Model already warm: press "Demo mode" and wait for "Demo ready"
    BEFORE starting the capture. Never film a loading bar.
[ ] Status strip readable and TRUE — whatever it says, your narration matches it
[ ] Phone on silent, on the desk, not in shot
[ ] One dry run of the whole 3 minutes, out loud, timed
```

### 6 · If something goes wrong on the day

- **A clip records a spinner:** the model wasn't warm. Press Demo mode, wait,
  re-run just that clip.
- **The run ends Blocked instead of Pass:** you're on the local tier. The
  scripted tier is the default with no key — check the strip says `mock`.
- **A clip is too short to narrate over:** hold the last frame in Shotcut
  (right-click → Properties → increase duration). Do not speed up the audio.
- **You're running long:** cut line 7 from the insight section and lines 2–3
  from the architecture section. Never cut the close.
