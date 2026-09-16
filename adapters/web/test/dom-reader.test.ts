/**
 * @vitest-environment jsdom
 *
 * Unit tests for the reader's FLAG COMPUTATION — the part that is genuinely the
 * adapter's job. jsdom has no layout engine, so every rectangle is zero; we stub
 * the geometry so the flags can be tested honestly and leave the
 * layout-dependent rules (offscreen, area ranking) to the Chromium measurement
 * harness in scripts/measure-screens.mjs, where they actually mean something.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DomScreenReader } from '../src/dom-reader.js';

/** Give every element a plausible rectangle so pruning has geometry to work with. */
function stubLayout(root: Element, height = 40): void {
  let top = 0;
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const y = top;
    top += 4;
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ x: 0, y, top: y, left: 0, right: 300, bottom: y + height, width: 300, height }) as DOMRect;
  }
}

function read(html: string) {
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const root = document.getElementById('app') as Element;
  stubLayout(root);
  const reader = new DomScreenReader({ appId: 'test', root: () => root, screenId: () => 'screen' });
  const result = reader.readDetailed();
  if (!result.ok) throw new Error(result.error.message);
  return { ...result.value, reader, root };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('flags the reader computes', () => {
  it('marks a <button> clickable', () => {
    const { snapshot } = read('<button>Add</button>');
    expect(snapshot.state.nodes.find((n) => n.text === 'Add')?.clickable).toBe(true);
  });

  it('marks a div with role=button clickable', () => {
    const { snapshot } = read('<div role="button">Apply</div>');
    expect(snapshot.state.nodes.find((n) => n.text === 'Apply')?.clickable).toBe(true);
  });

  it('does not mark an anchor without href clickable', () => {
    const { snapshot } = read('<a>Not a link</a>');
    expect(snapshot.state.nodes.find((n) => n.text === 'Not a link')?.clickable).toBe(false);
  });

  it('marks text inputs editable and carries their current value as text', () => {
    const { snapshot } = read('<input type="search" value="biryani" aria-label="Search" />');
    const field = snapshot.state.nodes.find((n) => n.editable);
    expect(field?.text).toBe('biryani');
    expect(field?.desc).toBe('Search');
  });

  it('does not mark a checkbox editable, only clickable and checkable', () => {
    const { snapshot } = read('<input type="checkbox" checked aria-label="Veg" />');
    const box = snapshot.state.nodes[0];
    expect(box?.editable).toBe(false);
    expect(box?.clickable).toBe(true);
    expect(box?.checked).toBe(true);
  });

  it('reads aria-pressed as checked state, so a filter chip reports on or off', () => {
    const { snapshot } = read('<button aria-pressed="true">Pure Veg</button>');
    expect(snapshot.state.nodes[0]?.checked).toBe(true);
  });

  it('treats disabled and aria-disabled as not enabled, and prunes them', () => {
    const { snapshot, fates } = read('<button disabled>Sold out</button><button aria-disabled="true">Apply</button>');
    expect(snapshot.state.nodes.some((n) => n.text === 'Sold out')).toBe(false);
    expect([...fates.values()].filter((f) => f === 'disabled')).toHaveLength(2);
  });

  it('treats aria-hidden and display:none as invisible', () => {
    const { fates } = read('<p aria-hidden="true">decorative</p><p style="display:none">gone</p>');
    expect([...fates.values()].filter((f) => f === 'invisible').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the text a node presents', () => {
  it('gives a clickable card the text of its children, space-joined', () => {
    const { snapshot } = read(
      '<button class="card"><span>Deccan Dastarkhwan</span><span>Biryani</span><span>4.5</span></button>',
    );
    const card = snapshot.state.nodes.find((n) => n.clickable);
    expect(card?.text).toBe('Deccan Dastarkhwan Biryani 4.5');
  });

  it('excludes aria-hidden decoration from a control name', () => {
    const { snapshot } = read('<button><span aria-hidden="true">DD</span><span>Deccan Dastarkhwan</span></button>');
    expect(snapshot.state.nodes.find((n) => n.clickable)?.text).toBe('Deccan Dastarkhwan');
  });

  it('does not let a scroll container claim the whole page as its label', () => {
    document.body.innerHTML = '<div id="app"><main><p>A lot of page text here</p></main></div>';
    const root = document.getElementById('app') as Element;
    const main = root.querySelector('main') as HTMLElement;
    Object.defineProperty(main, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(main, 'clientHeight', { value: 400, configurable: true });
    main.style.overflowY = 'auto';
    stubLayout(root);

    const reader = new DomScreenReader({ appId: 't', root: () => root, screenId: () => 's' });
    const result = reader.readDetailed();
    if (!result.ok) throw new Error('read failed');
    const scroller = result.value.snapshot.state.nodes.find((n) => n.scrollable);
    expect(scroller).toBeDefined();
    expect(scroller?.text).toBe('');
  });

  it('gives a non-interactive wrapper only its own text', () => {
    const { snapshot } = read('<div>Total <span>₹374</span></div>');
    expect(snapshot.state.nodes.map((n) => n.text)).toContain('Total');
  });

  it('uses aria-label as the description of an icon-only button', () => {
    const { snapshot } = read('<button aria-label="Clear search"><svg viewBox="0 0 1 1"></svg></button>');
    const btn = snapshot.state.nodes.find((n) => n.clickable);
    expect(btn?.desc).toBe('Clear search');
  });

  it('falls back to alt text on an image and placeholder on an input', () => {
    const { snapshot } = read('<img alt="Vegetarian" /><input placeholder="Search dishes" />');
    expect(snapshot.state.nodes.map((n) => n.desc)).toEqual(
      expect.arrayContaining(['Vegetarian', 'Search dishes']),
    );
  });

  it('resolves aria-labelledby', () => {
    const { snapshot } = read('<h2 id="lbl">Bill details</h2><section aria-labelledby="lbl"><p>x</p></section>');
    expect(snapshot.state.nodes.some((n) => n.desc === 'Bill details')).toBe(true);
  });
});

describe('indices and element resolution', () => {
  it('assigns dense indices from 0 and resolves each back to its element', () => {
    const { snapshot, reader } = read('<button>One</button><button>Two</button><button>Three</button>');
    expect(snapshot.state.nodes.map((n) => n.index)).toEqual([0, 1, 2]);
    expect(reader.elementFor(0)?.textContent).toBe('One');
    expect(reader.elementFor(2)?.textContent).toBe('Three');
    expect(reader.elementFor(9)).toBeUndefined();
  });

  it('reports a missing root as a Result, never a throw', () => {
    const reader = new DomScreenReader({ appId: 't', root: () => null });
    const result = reader.readSync();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-root');
  });

  it('does not descend into an <svg>', () => {
    const { candidates } = read('<button aria-label="Cart"><svg viewBox="0 0 1 1"><circle/><path/></svg></button>');
    expect(candidates.some((c) => c.role === 'img')).toBe(true);
    expect(candidates).toHaveLength(3); // #app, button, svg — never the circle or path
  });
});
