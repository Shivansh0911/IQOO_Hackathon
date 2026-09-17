/**
 * Splits "the mic is broken" into the two causes it can actually have.
 *
 *   pnpm mic:doctor
 *
 * Opens a page in YOUR Chrome — not a test browser — and runs two experiments:
 *
 *   TEST A · speech recognition on its own.
 *   TEST B · speech recognition while a getUserMedia stream is open, which is
 *            what the app does, because it measures its own audio levels for
 *            the energy gate.
 *
 * Why it exists: Playwright's Chromium has no speech service at all, so it
 * cannot tell these apart, and the difference decides where the fix goes.
 *
 *   A fails too          → Chrome cannot reach its transcription service on
 *                          this network. Nothing in our code can fix that.
 *   A works, B fails     → holding the microphone for the level meter is
 *                          killing recognition. That is ours to fix, and this
 *                          is the evidence for it.
 *   Both work            → the app's own wiring is at fault; send me the page.
 *
 * It is served over http://127.0.0.1 because getUserMedia and Web Speech both
 * require a secure context, and file:// is not one.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 4327;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Origo · microphone doctor</title>
<style>
  body { background:#0E0E0E; color:#F7F5EF; font:15px/1.55 'Segoe UI',system-ui,sans-serif;
         margin:0; padding:34px 30px; max-width:900px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:#A8A6A0; margin:0 0 26px; }
  button { background:#F5B400; color:#0E0E0E; border:0; font:600 15px/1 'Segoe UI',sans-serif;
           padding:13px 20px; cursor:pointer; }
  button:disabled { background:#2E2E2B; color:#777; cursor:default; }
  .test { border-left:3px solid #2E2E2B; padding:12px 16px; margin:18px 0; background:#1A1A18; }
  .test.pass { border-left-color:#0A7C3A; }
  .test.fail { border-left-color:#E2231A; }
  .test h2 { font-size:14px; letter-spacing:.14em; text-transform:uppercase; color:#A8A6A0; margin:0 0 8px; }
  .verdict { font-weight:600; }
  code { font-family:'Cascadia Mono',Consolas,monospace; font-size:13px; color:#F5B400; }
  #answer { margin-top:26px; padding:16px; background:#1A1A18; border-left:3px solid #F5B400; }
  ol { padding-left:20px; color:#A8A6A0; }
</style></head><body>
<h1>Microphone doctor</h1>
<p class="sub">Two experiments. Press the button, then say &ldquo;<b>biryani search karo</b>&rdquo; clearly each
time you are asked. Takes about twenty seconds.</p>

<button id="go">Run both tests</button>

<div class="test" id="tA"><h2>Test A · recognition alone</h2><div class="verdict">not run yet</div></div>
<div class="test" id="tB"><h2>Test B · recognition while the level meter holds the mic</h2><div class="verdict">not run yet</div></div>
<div id="answer" hidden></div>

<script>
const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;

function show(id, ok, lines) {
  const el = document.getElementById(id);
  el.className = 'test ' + (ok ? 'pass' : 'fail');
  el.querySelector('.verdict').innerHTML = lines.join('<br>');
}

/** One recognition attempt. Resolves with everything that happened. */
function attempt(label) {
  return new Promise((resolve) => {
    if (!Ctor) return resolve({ transcript: '', events: ['NO SpeechRecognition IN THIS BROWSER'], error: 'unsupported' });
    const r = new Ctor();
    r.lang = 'en-IN';
    r.continuous = true;
    r.interimResults = true;
    const events = [];
    let transcript = '';
    let error = '';
    for (const name of ['start','audiostart','soundstart','speechstart','speechend','end','nomatch']) {
      r.addEventListener(name, () => events.push(name));
    }
    r.addEventListener('error', (e) => { error = e.error; events.push('error:' + e.error); });
    r.addEventListener('result', (e) => {
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      events.push('result');
    });
    try { r.start(); } catch (e) { error = String(e); events.push('start threw'); }
    setTimeout(() => { try { r.stop(); } catch {} }, 6000);
    setTimeout(() => resolve({ transcript: transcript.trim(), events, error }), 7200);
  });
}

document.getElementById('go').onclick = async () => {
  const go = document.getElementById('go');
  go.disabled = true;

  // ── TEST A ────────────────────────────────────────────────────────────────
  go.textContent = 'TEST A — speak now (6s)';
  const a = await attempt('A');
  show('tA', Boolean(a.transcript), [
    a.transcript ? '<b>PASS</b> — heard: <code>' + a.transcript + '</code>'
                 : '<b>FAIL</b> — no transcript' + (a.error ? ', error <code>' + a.error + '</code>' : ', and no error was reported'),
    'events: <code>' + a.events.join(' → ') + '</code>',
  ]);

  // ── TEST B ────────────────────────────────────────────────────────────────
  go.textContent = 'TEST B — speak again (6s)';
  let stream = null, ctx = null, peak = 0;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (const v of buf) s += v * v;
      peak = Math.max(peak, Math.sqrt(s / buf.length));
      if (ctx.state === 'running') requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) {
    show('tB', false, ['<b>FAIL</b> — could not open the microphone: <code>' + e.name + '</code>']);
  }

  const b = await attempt('B');
  try { stream && stream.getTracks().forEach(t => t.stop()); ctx && ctx.close(); } catch {}
  show('tB', Boolean(b.transcript), [
    b.transcript ? '<b>PASS</b> — heard: <code>' + b.transcript + '</code>'
                 : '<b>FAIL</b> — no transcript' + (b.error ? ', error <code>' + b.error + '</code>' : ', and no error was reported'),
    'measured loudness while speaking: <code>' + peak.toFixed(4) + '</code> (silence is under 0.012)',
    'events: <code>' + b.events.join(' → ') + '</code>',
  ]);

  // ── The answer ────────────────────────────────────────────────────────────
  const answer = document.getElementById('answer');
  answer.hidden = false;
  if (!Ctor) {
    answer.innerHTML = '<b>This browser has no Web Speech API.</b> Use Chrome or Edge. Brave blocks it; Firefox does not implement it.';
  } else if (!a.transcript && !b.transcript) {
    answer.innerHTML = '<b>Chrome itself cannot transcribe on this machine or network.</b> Recognition failed even with nothing else touching the microphone, so this is not something the app is doing. Usual causes: a VPN or firewall blocking Google\\'s speech endpoint, or a Chromium build without the service. <b>Nothing in our code can fix it</b> — typing the goal works identically.' + (peak < 0.012 ? '<br><br><b>Also:</b> loudness measured under the silence threshold, so check the right input device is selected in Windows sound settings.' : '');
  } else if (a.transcript && !b.transcript) {
    answer.innerHTML = '<b>Found it, and it is ours.</b> Recognition works alone but dies when the level meter holds the microphone at the same time. Send me this page and I will stop the app doing that.';
  } else {
    answer.innerHTML = '<b>Recognition works in both tests.</b> So the fault is in the app\\'s own wiring rather than the browser — send me this page and the message the voice panel showed you.';
  }
  go.textContent = 'Run both tests again';
  go.disabled = false;
};
</script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\nMicrophone doctor is at ${url}`);
  console.log('Opening it in your default browser. Use Chrome or Edge.\n');
  console.log('Press the button, say "biryani search karo" when asked, twice.');
  console.log('Then read the amber box at the bottom and tell me what it says.\n');
  console.log('Ctrl+C here when you are done.\n');
  // Windows: `start` needs a shell, and an empty title argument.
  spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
});
