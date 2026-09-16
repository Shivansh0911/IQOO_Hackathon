import { describe, expect, it } from 'vitest';
import { estimateTokens, hashScreenState, MAX_NODES, toPromptJson } from '../src/screen-state.js';
import { bounds, node, screen } from './fixtures.js';

describe('toPromptJson — the exact bytes the model sees', () => {
  it('emits the documented compact shape', () => {
    const s = screen([
      node({ index: 0, role: 'edit', text: 'Search', editable: true, clickable: true }),
      node({ index: 1, role: 'btn', text: 'Add', clickable: true }),
    ]);
    expect(toPromptJson(s)).toBe(
      '[{"i":0,"role":"edit","text":"Search","clk":1,"ed":1},{"i":1,"role":"btn","text":"Add","clk":1}]',
    );
  });

  it('omits every empty or falsy field', () => {
    const s = screen([node({ index: 0, role: 'text', text: 'Hi' })]);
    expect(toPromptJson(s)).toBe('[{"i":0,"role":"text","text":"Hi"}]');
  });

  it('omits desc when it merely repeats text', () => {
    const s = screen([node({ index: 0, role: 'btn', text: 'Cart', desc: 'cart', clickable: true })]);
    expect(toPromptJson(s)).toBe('[{"i":0,"role":"btn","text":"Cart","clk":1}]');
  });

  it('keeps desc when it adds something, as for an icon-only button', () => {
    const s = screen([node({ index: 0, role: 'btn', desc: 'Clear search', clickable: true })]);
    expect(toPromptJson(s)).toBe('[{"i":0,"role":"btn","desc":"Clear search","clk":1}]');
  });

  it('emits chk as 0 or 1 only when the node is checkable', () => {
    const s = screen([
      node({ index: 0, role: 'switch', text: 'Pure Veg', clickable: true, checked: false }),
      node({ index: 1, role: 'switch', text: 'Fast', clickable: true, checked: true }),
      node({ index: 2, role: 'btn', text: 'Go', clickable: true }),
    ]);
    const parsed = JSON.parse(toPromptJson(s)) as Record<string, unknown>[];
    expect(parsed[0]?.chk).toBe(0);
    expect(parsed[1]?.chk).toBe(1);
    expect(parsed[2]).not.toHaveProperty('chk');
  });

  it('marks scrollable nodes', () => {
    const s = screen([node({ index: 0, role: 'list', text: 'Results', scrollable: true })], [0]);
    expect(toPromptJson(s)).toContain('"scr":1');
  });

  it('truncates long text rather than paying tokens for a paragraph', () => {
    const s = screen([node({ index: 0, role: 'text', text: 'x'.repeat(200) })]);
    const parsed = JSON.parse(toPromptJson(s)) as { text: string }[];
    expect(parsed[0]?.text.length).toBeLessThanOrEqual(60);
    expect(parsed[0]?.text.endsWith('…')).toBe(true);
  });

  it('contains no whitespace, newlines or nulls', () => {
    const s = screen([node({ index: 0, role: 'btn', text: 'Add to cart', clickable: true })]);
    const json = toPromptJson(s);
    expect(json).not.toMatch(/\n|null|: /);
  });

  // Two budgets, because they are two different claims and only one of them is
  // the headline. The deck says "~300 tokens" about a TYPICAL screen; the
  // worst case is a full 40 nodes that all carry long labels, and it costs more.
  // Both numbers are asserted here so neither can drift quietly.
  it('holds the ~300 token budget on a typical screen', () => {
    const s = screen([
      node({ index: 0, role: 'edit', text: 'Search for food', editable: true }),
      node({ index: 1, role: 'btn', desc: 'Clear search', clickable: true }),
      ...Array.from({ length: 4 }, (_, i) =>
        node({ index: 2 + i, role: 'switch', text: ['Rating 4.0+', 'Pure Veg', 'Fast Delivery', 'Offers'][i] ?? '', clickable: true, checked: false }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        node({ index: 6 + i, role: 'btn', text: `Restaurant ${i} 4.${i} 30 min`, clickable: true }),
      ),
      node({ index: 16, role: 'list', text: '', scrollable: true }),
      node({ index: 17, role: 'btn', text: 'Cart', clickable: true }),
    ]);
    expect(estimateTokens(toPromptJson(s))).toBeLessThanOrEqual(300);
  });

  it('stays bounded in the worst case: 40 nodes that all carry long labels', () => {
    const s = screen(
      Array.from({ length: MAX_NODES }, (_, i) =>
        node({ index: i, role: 'btn', text: `Restaurant number ${i} 4.4 star`, clickable: true }),
      ),
    );
    // Still well under a single screenshot (~1500 tokens), which is the
    // comparison the thesis actually rests on.
    expect(estimateTokens(toPromptJson(s))).toBeLessThanOrEqual(900);
  });
});

describe('hashScreenState — drives settle and stuck detection', () => {
  const base = screen([node({ index: 0, role: 'btn', text: 'Add', clickable: true })]);

  it('is stable across re-reads of an unchanged screen', () => {
    const later = { ...base, timestampMs: base.timestampMs + 5000 };
    expect(hashScreenState(later)).toBe(hashScreenState(base));
  });

  it('ignores pure movement, because a screen that only scrolled a pixel is the same screen', () => {
    const moved = screen([node({ index: 0, role: 'btn', text: 'Add', clickable: true, bounds: bounds(0, 7, 100, 40) })]);
    expect(hashScreenState(moved)).toBe(hashScreenState(base));
  });

  it('changes when text changes', () => {
    const changed = screen([node({ index: 0, role: 'btn', text: 'Added', clickable: true })]);
    expect(hashScreenState(changed)).not.toBe(hashScreenState(base));
  });

  it('changes when a node appears', () => {
    const grown = screen([...base.nodes, node({ index: 1, role: 'text', text: 'Cart (1)' })]);
    expect(hashScreenState(grown)).not.toBe(hashScreenState(base));
  });

  it('changes when a checkbox toggles', () => {
    const on = screen([node({ index: 0, role: 'switch', text: 'Veg', checked: true })]);
    const off = screen([node({ index: 0, role: 'switch', text: 'Veg', checked: false })]);
    expect(hashScreenState(on)).not.toBe(hashScreenState(off));
  });
});
