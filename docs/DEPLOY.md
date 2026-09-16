# Deploy

Written to be followed while tired, by someone who has never deployed this repo.
Commands and checklists, not prose.

---

## Which host, and why

**Vercel.** Reasons, in order of how much they matter:

1. **Header control per path, in a committed file.** `vercel.json` is in the
   repo, so the header configuration is reviewed and versioned rather than being
   a setting somebody clicked. This is the highest-risk part of the deploy — get
   it wrong and the on-device tier silently dies in production while localhost
   works fine.
2. **No COEP needed, and Vercel does not add one.** Some hosts inject
   cross-origin headers; if `Cross-Origin-Embedder-Policy: require-corp` ever
   appears, the model-weight fetch is blocked and the local tier breaks. Vercel
   sends exactly what `vercel.json` says.
3. Free tier is enough: static output, no serverless function in the critical
   path, HTTPS and a custom subdomain included.
4. `pnpm` and a workspace monorepo work without configuration.

**Netlify** is a fine alternative and `netlify.toml` is committed too.
**Cloudflare Pages** works via the `_headers` file, which is also committed
(`apps/demo/public/_headers`, copied into `dist` by the build).

---

## Fresh clone to live URL

```bash
# 1 · Clone and install
git clone https://github.com/Shivansh0911/IQOO_Hackathon.git
cd IQOO_Hackathon
pnpm install
#   expect: "Done in ~30s", no EPERM, no peer warnings that mention eslint 10

# 2 · Prove it is healthy BEFORE deploying
pnpm verify
#   expect: 5 "ok" tsconfig lines, "boundaries: 8/8 ok", "Tests  282 passed"
#   if this fails, do not deploy — fix it first

# 3 · Build what will actually be served
npx vite build apps/demo
#   expect: dist/index.html, dist/assets/*.css, two .js chunks, and dist/_headers
#   the SECOND js chunk is ~6MB — that is WebLLM, and it is lazy-loaded

# 4 · Deploy
npm i -g vercel        # once, on this machine
vercel login           # opens a browser
vercel --prod
#   Vercel reads vercel.json: build command, output directory and headers are
#   already set. Answer "yes" to linking a new project; accept the defaults.
#   It prints the live URL. That is the link.
```

**Netlify instead:**
```bash
npm i -g netlify-cli
netlify login
netlify deploy --prod
#   publish directory: apps/demo/dist   (netlify.toml already says this)
```

**Drag-and-drop, if the CLI misbehaves:** build, then drag `apps/demo/dist` onto
app.netlify.com/drop. The `_headers` file inside `dist` carries the headers.

---

## The headers, and why each one exists

Already committed as [`vercel.json`](../vercel.json),
[`netlify.toml`](../netlify.toml) and
[`apps/demo/public/_headers`](../apps/demo/public/_headers). Copy whichever your
host needs.

```
Cross-Origin-Opener-Policy: same-origin
    Isolates our browsing context. Harmless, and good hygiene.

Cross-Origin-Embedder-Policy: *** DELIBERATELY ABSENT ***
    WebGPU does NOT require cross-origin isolation. Setting
    require-corp BLOCKS the cross-origin fetch of the model weights and the page
    dies mid-download — measured, not assumed. If you ever need isolation, use
    `credentialless`, NEVER `require-corp`.

X-Content-Type-Options: nosniff
    Standard. Stops the browser guessing content types.

Referrer-Policy: no-referrer
    We send nothing to anyone; do not leak the URL either.

Cache-Control: public, max-age=31536000, immutable   (on /assets/* only)
    Filenames are content-hashed, so they can be cached forever. index.html is
    deliberately NOT cached this way, or a redeploy would never be picked up.
```

---

## Verify the deploy worked — tick all four

Do this **on the live URL**, not on localhost. Config is not evidence.

- [ ] **1 · The page loads and Tiffin is on the left.**
      Expect something on screen in under a second.

- [ ] **2 · The status strip reads `PLANNER mock · MODEL scripted`.**
      Before the model is loaded this is correct and honest. If it says
      `PLANNER none` after a second or two, the tier probe failed — check the
      browser console.

- [ ] **3 · Press `Demo mode`, wait, then check the strip says `PLANNER local`
      with an amber `on-device`, and `MODEL Qwen2.5-1.5B-Instruct-q4f16_1-MLC`.**
      This is the one that proves the headers are right. If it stays on `mock`
      or `cloud` after the model finishes loading, COOP/COEP is wrong —
      see the failure table below. First load downloads ~1.1GB.

- [ ] **4 · Hard-reload (Ctrl+Shift+R) and press `Demo mode` again.**
      Expect it ready in a few seconds, not minutes. That proves the weights
      cached on this origin. If it re-downloads, read "model re-downloads" below.

Then run one goal end to end and confirm a verdict appears.

---

## Redeploying after a change

```bash
pnpm verify && npx vite build apps/demo && vercel --prod
```
About 90 seconds, most of it the build. The URL does not change.

---

## When it goes wrong

| symptom | cause | fix |
|---|---|---|
| **Strip says `cloud` or `mock` after the model loads** | COOP/COEP wrong, or the host injected `COEP: require-corp` | Open DevTools → Network → click the document → Response Headers. If `Cross-Origin-Embedder-Policy` is present, remove it from the host's settings. It must be absent or `credentialless` |
| **Model re-downloads on every visit** | The origin changed, or the browser evicted the cache. Weights are cached **per origin** — a preview URL and the production URL are different origins | Use the production URL for the demo. Check DevTools → Application → Cache Storage for a `webllm` entry |
| **Blank page, console says "Failed to load module"** | Output directory wrong | Must be `apps/demo/dist`. Confirm `dist/index.html` exists after the build |
| **Mic does nothing / no permission prompt** | Web Speech needs a secure context | Both Vercel and Netlify serve HTTPS, so this is already handled. Do not chase it. If testing locally use `localhost`, which also counts as secure |
| **"This browser has no WebGPU"** | Firefox or Safari, or an old Chrome | Chrome/Edge 113+. The app still runs on the cloud and mock tiers and says so |
| **Runs are very slow (tens of seconds a step)** | Chrome handed WebGPU the **integrated** GPU | The console prints the adapter name. On a laptop with two GPUs, set Chrome to "High performance" in the OS graphics settings. Measured: 2.3s vs 41s per call for the same model |
| **`pnpm install` fails with EPERM on Windows** | OneDrive or antivirus holding a file | Retry. If it persists, clone outside OneDrive |

---

## The Chrome extension (not deployed — loaded by hand)

Under two minutes:

```bash
node scripts/build-extension.mjs
#   expect: "Extension built to apps/extension/dist"
```

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select `apps/extension/dist`
4. Open any normal `https://` site — Wikipedia is the one we demo
5. Click the Origo Loop toolbar icon to open the side panel
6. Press **Connect to this tab**. If it says the content script has not loaded,
   **reload the tab** and press Connect again — a content script is only
   injected into pages loaded *after* the extension.
7. Paste an OpenRouter key in the panel's settings. The extension has no
   on-device tier (a side panel cannot run WebLLM), and it says so.

Goals are read-only by design. The destructive gate here blocks sign-in, post,
submit, buy and upload, and the panel denies every confirmation.

---

## Day of submission — the 5-minute check

Run this immediately before pasting the link into the form.

```
[ ] Open the live URL in a PRIVATE window (no cache, no localStorage).
[ ] Something on screen in under a second.
[ ] Strip reads: PLATFORM web · PLANNER mock · MODEL scripted · NETWORK on
[ ] Click "Cart total under ₹500" then Run. Verdict Pass in a few seconds.
[ ] Click "Guardrail · try to order" then Run. The confirmation sheet appears.
    Press Deny. Verdict Blocked. Tiffin did NOT reach the confirmation screen.
[ ] Click "Fails on purpose" then Run. Verdict is RED and reads
    "node 11 reads 4.5; expected > 4.9".
[ ] Press "Download HTML". A file arrives. Open it — it renders with no network.
[ ] Press "Demo mode". Wait for "Demo ready". Strip now reads PLANNER local,
    amber "on-device", MODEL Qwen2.5-1.5B-Instruct-q4f16_1-MLC.
[ ] Run one goal on the local tier. Verdict appears.
[ ] Open the link on your PHONE browser. Both panes visible, stacked. No
    horizontal scrolling.
```

If any line fails, the link is not ready. Everything on that list is verified by
`node scripts/verify-flows.mjs` against the production build, so a failure here
means the deploy differs from the build — almost always headers or output
directory.
