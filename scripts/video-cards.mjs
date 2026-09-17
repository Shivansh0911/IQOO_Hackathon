/**
 * The cards that make the rendered video self-explanatory with the sound off.
 *
 * Each card is an HTML page rendered by Playwright to a 1920x1080 PNG, then
 * held for a fixed duration by ffmpeg. HTML rather than ffmpeg's drawtext
 * because the cards use the project's real type and palette, and because
 * getting a condensed display face and proper letter-spacing out of drawtext is
 * not worth the fight.
 *
 * Exported separately from render-video.mjs so the card design can be inspected
 * and iterated without re-encoding a three-minute video.
 */

/** The palette, copied from apps/demo/src — kept in sync by eye, not by import
 * (RULE A: nothing here may reach into an app's source). */
export const PALETTE = {
  ink: '#0e0e0e',
  inkRaised: '#1a1a18',
  paper: '#f7f5ef',
  paperDim: '#a8a6a0',
  amber: '#f5b400',
  red: '#e2231a',
  green: '#0a7c3a',
  hairline: '#2e2e2b',
};

const FONT_STACKS = {
  display: `'Archivo Narrow','Oswald','Helvetica Neue Condensed','Arial Narrow',sans-serif`,
  sans: `'Inter','Segoe UI',system-ui,sans-serif`,
  mono: `ui-monospace,'Cascadia Mono',Consolas,monospace`,
};

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; }
  body {
    background: ${PALETTE.ink};
    color: ${PALETTE.paper};
    font-family: ${FONT_STACKS.sans};
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 170px;
    overflow: hidden;
  }
  /* The amber hairline is the one piece of chrome every card shares, so the
     cards read as one set rather than seven unrelated slides. */
  .rule { width: 132px; height: 6px; background: ${PALETTE.amber}; }
  .kicker {
    font-family: ${FONT_STACKS.mono};
    font-size: 25px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: ${PALETTE.paperDim};
  }
  h1 {
    font-family: ${FONT_STACKS.display};
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 0.96;
  }
  .amber { color: ${PALETTE.amber}; }
  .dim { color: ${PALETTE.paperDim}; }
`;

/**
 * Archivo Narrow is fetched from Google Fonts rather than assumed installed —
 * it is not present on a stock Windows machine, and without it the display face
 * falls back to Segoe UI and stops being condensed. If the network is down the
 * fallback stack still renders a readable card, just not the intended one.
 */
const FONT_LINK =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@600;700&family=Inter:wght@400;600&display=swap">';

function page(body, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}
<style>${BASE_CSS}${extraCss}</style></head><body>${body}</body></html>`;
}

/** The opening title card. */
export function titleCard({ team }) {
  return page(
    `
    <div class="rule" style="margin-bottom:54px"></div>
    <h1 style="font-size:188px">ORIGO<span class="amber"> LOOP</span></h1>
    <p style="font-family:${FONT_STACKS.display};font-size:62px;line-height:1.16;margin-top:36px;max-width:1360px">
      Tell it what to test.<br><span class="amber">It tests itself.</span>
    </p>
    <p class="kicker" style="margin-top:72px">${team}</p>
  `,
  );
}

/**
 * A section divider: the heading, plus one line that explains why the coming
 * footage matters. Muted, this line is all a viewer gets — so it carries the
 * argument, not a label.
 */
export function sectionCard({ index, heading, context }) {
  return page(
    `
    <p class="kicker" style="margin-bottom:38px">${String(index).padStart(2, '0')}</p>
    <div class="rule" style="margin-bottom:44px"></div>
    <h1 style="font-size:132px;max-width:1560px">${heading}</h1>
    <p style="font-size:50px;line-height:1.34;margin-top:44px;max-width:1420px" class="dim">${context}</p>
  `,
  );
}

/**
 * A card that carries the narration itself, for the two sections with no
 * footage behind them (the problem, and the porting argument).
 *
 * The type scale is computed from the line count rather than fixed: seven lines
 * at the section-card size overflowed 1080p and clipped both the heading and
 * the last line. Measured by extracting frames from the render, not guessed.
 */
export function statementCard({ index, heading, lines }) {
  const many = lines.length > 4;
  const size = many ? 36 : 46;
  const gap = many ? 18 : 30;
  const items = lines
    .map((line) => `<p style="font-size:${size}px;line-height:1.36;margin-bottom:${gap}px">${line}</p>`)
    .join('');

  return page(
    `
    <div style="display:flex;flex-direction:column;justify-content:center;height:1080px;padding:64px 0">
      <p class="kicker" style="margin-bottom:26px">${String(index).padStart(2, '0')}</p>
      <div class="rule" style="margin-bottom:30px"></div>
      <h1 style="font-size:${many ? 84 : 118}px;margin-bottom:${many ? 34 : 46}px">${heading}</h1>
      <div class="dim" style="max-width:1480px">${items}</div>
    </div>
  `,
    // The outer flex on body would double up with the inner wrapper, so the
    // statement card manages its own vertical centring.
    'body { justify-content: flex-start; }',
  );
}

/**
 * The closing card. Deliberately states what is NOT proven: the three-line
 * PROVEN/PROVEN/OPEN framing is the same one used in the README, and softening
 * it here to look better would contradict the repo a judge can read.
 */
export function closingCard({ repo, liveUrl, proven, open, names, affiliation }) {
  const provenRows = proven
    .map(
      (line) => `
      <li style="display:flex;gap:30px;align-items:baseline;margin-bottom:28px">
        <span style="font-family:${FONT_STACKS.mono};font-size:27px;letter-spacing:0.18em;color:${PALETTE.green};flex:0 0 150px">PROVEN</span>
        <span style="font-size:41px;line-height:1.28">${line}</span>
      </li>`,
    )
    .join('');

  return page(
    `
    <div class="rule" style="margin-bottom:46px"></div>
    <h1 style="font-size:96px;margin-bottom:56px">WHAT IS PROVEN,<br>AND WHAT IS <span class="amber">OPEN</span></h1>
    <ul style="list-style:none;max-width:1560px">
      ${provenRows}
      <li style="display:flex;gap:30px;align-items:baseline;margin-bottom:28px">
        <span style="font-family:${FONT_STACKS.mono};font-size:27px;letter-spacing:0.18em;color:${PALETTE.amber};flex:0 0 150px">OPEN</span>
        <span style="font-size:41px;line-height:1.28">${open}</span>
      </li>
    </ul>
    <div style="margin-top:52px;padding-top:36px;border-top:2px solid ${PALETTE.hairline}">
      <!-- The names are SET here rather than spoken: the synthesiser mangled
           both, and a mispronounced name in the closing seconds is worse than
           a silent one. In type they are legible and spelled right. -->
      <div style="font-family:${FONT_STACKS.display};font-size:46px;letter-spacing:0.01em;margin-bottom:8px">
        ${names.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}
      </div>
      <div class="kicker" style="font-size:23px;margin-bottom:26px">${affiliation}</div>
      <div style="font-family:${FONT_STACKS.mono};font-size:29px;line-height:1.7">
        <div class="dim">REPO &nbsp;&nbsp;<span style="color:${PALETTE.paper}">${repo}</span></div>
        <div class="dim">LIVE DEMO &nbsp;&nbsp;<span class="amber">${liveUrl}</span></div>
      </div>
    </div>
  `,
  );
}
