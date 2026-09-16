import { describe, expect, it } from 'vitest';
import { formatPruneStats, pruneAndRank } from '../src/prune.js';
import { bounds, candidate } from './fixtures.js';

describe('the five context-free rules, first match wins', () => {
  it('drops invisible nodes', () => {
    const r = pruneAndRank([candidate({ id: 0, text: 'Hidden', visible: false })]);
    expect(r.stats.dropped.invisible).toBe(1);
    expect(r.nodes).toHaveLength(0);
  });

  it('drops zero-area nodes', () => {
    const r = pruneAndRank([candidate({ id: 0, text: 'Empty', bounds: bounds(0, 0, 0, 0) })]);
    expect(r.stats.dropped['zero-area']).toBe(1);
  });

  it('drops offscreen nodes', () => {
    const r = pruneAndRank([candidate({ id: 0, text: 'Below the fold', onScreen: false })]);
    expect(r.stats.dropped.offscreen).toBe(1);
  });

  it('drops disabled nodes', () => {
    const r = pruneAndRank([candidate({ id: 0, role: 'btn', text: 'Apply', clickable: true, enabled: false })]);
    expect(r.stats.dropped.disabled).toBe(1);
  });

  it('drops no-signal nodes: not interactive, no text, no description', () => {
    const r = pruneAndRank([candidate({ id: 0, role: 'other' })]);
    expect(r.stats.dropped['no-signal']).toBe(1);
  });

  it('keeps a node whose only signal is an accessible description (icon-only button)', () => {
    const r = pruneAndRank([candidate({ id: 0, role: 'btn', desc: 'Clear search', clickable: true })]);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]?.desc).toBe('Clear search');
  });

  it('applies the rules in order: an invisible disabled node is reported as invisible', () => {
    const r = pruneAndRank([candidate({ id: 0, text: 'x', visible: false, enabled: false })]);
    expect(r.stats.dropped.invisible).toBe(1);
    expect(r.stats.dropped.disabled).toBe(0);
  });
});

describe('THE CRITICAL CASE — a clickable card whose text lives in child elements', () => {
  // This is the exact boundary where text-container can delete the only tappable
  // target on the screen. If this test ever fails, the results screen becomes
  // unusable to the agent and the demo dies silently.
  const card = [
    candidate({
      id: 0,
      role: 'btn',
      clickable: true,
      text: 'Paradise Biryani Hyderabadi, Biryani 4.4 ★ 32 min ₹400 for two',
      bounds: bounds(0, 0, 360, 120),
      depth: 3,
    }),
    candidate({ id: 1, parent: 0, role: 'text', text: 'Paradise Biryani', bounds: bounds(8, 8, 200, 20), depth: 4 }),
    candidate({ id: 2, parent: 0, role: 'text', text: 'Hyderabadi, Biryani', bounds: bounds(8, 32, 200, 16), depth: 4 }),
    candidate({ id: 3, parent: 0, role: 'text', text: '4.4 ★', bounds: bounds(8, 52, 60, 16), depth: 4 }),
    candidate({ id: 4, parent: 0, role: 'text', text: '32 min', bounds: bounds(80, 52, 60, 16), depth: 4 }),
    candidate({ id: 5, parent: 0, role: 'text', text: '₹400 for two', bounds: bounds(150, 52, 90, 16), depth: 4 }),
  ];

  it('keeps the card', () => {
    const r = pruneAndRank(card);
    const kept = r.nodes.map((n) => n.text);
    expect(r.fates.get(0)).toBe('kept');
    expect(kept.some((t) => t.includes('Paradise Biryani'))).toBe(true);
  });

  it('keeps the card even when every child is also a candidate', () => {
    const r = pruneAndRank(card);
    expect(r.nodes.some((n) => n.clickable)).toBe(true);
  });

  it('drops the children as echoes of the clickable ancestor, not the card', () => {
    const r = pruneAndRank(card);
    expect(r.stats.dropped['text-container']).toBe(5);
    expect(r.nodes).toHaveLength(1);
  });

  it('collapses a non-interactive wrapper whose text is only its children', () => {
    const r = pruneAndRank([
      candidate({ id: 0, role: 'other', text: 'Delivery fee ₹29', bounds: bounds(0, 0, 300, 40) }),
      candidate({ id: 1, parent: 0, role: 'text', text: 'Delivery fee', bounds: bounds(0, 0, 150, 20) }),
      candidate({ id: 2, parent: 0, role: 'text', text: '₹29', bounds: bounds(150, 0, 60, 20) }),
    ]);
    expect(r.fates.get(0)).toBe('text-container');
    expect(r.nodes.map((n) => n.text)).toEqual(['Delivery fee', '₹29']);
  });

  it('keeps a wrapper that says something its children do not', () => {
    const r = pruneAndRank([
      candidate({ id: 0, role: 'text', text: 'Grand total ₹1,240 including taxes', bounds: bounds(0, 0, 300, 40) }),
      candidate({ id: 1, parent: 0, role: 'text', text: '₹1,240', bounds: bounds(200, 0, 60, 20) }),
    ]);
    expect(r.fates.get(0)).toBe('kept');
  });

  it('never drops an interactive node as a text-container, however nested', () => {
    const r = pruneAndRank([
      candidate({ id: 0, role: 'btn', clickable: true, text: 'Add', bounds: bounds(0, 0, 100, 40) }),
      candidate({ id: 1, parent: 0, role: 'btn', clickable: true, text: 'Add', bounds: bounds(0, 0, 100, 40) }),
    ]);
    expect(r.nodes).toHaveLength(2);
  });
});

describe('ranking, capping and reindexing', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    candidate({ id: i, role: 'btn', clickable: true, text: `Item ${i}`, bounds: bounds(0, i * 10, 100, 60 - i) }),
  );

  it('caps at 40 by default', () => {
    const r = pruneAndRank(many);
    expect(r.nodes).toHaveLength(40);
    expect(r.stats.overCap).toBe(20);
  });

  it('keeps the largest nodes, not the first ones', () => {
    const r = pruneAndRank(many);
    // Heights descend with id, so ids 0..39 are the 40 largest.
    expect(r.indexToCandidateId).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it('presents the kept set in traversal order, indexed densely from 0', () => {
    const r = pruneAndRank([
      candidate({ id: 0, role: 'btn', clickable: true, text: 'small', bounds: bounds(0, 0, 10, 10) }),
      candidate({ id: 1, role: 'btn', clickable: true, text: 'huge', bounds: bounds(0, 20, 300, 300) }),
      candidate({ id: 2, role: 'btn', clickable: true, text: 'medium', bounds: bounds(0, 40, 100, 100) }),
    ]);
    expect(r.nodes.map((n) => n.index)).toEqual([0, 1, 2]);
    expect(r.nodes.map((n) => n.text)).toEqual(['small', 'huge', 'medium']);
    expect(r.indexToCandidateId).toEqual([0, 1, 2]);
  });

  it('honours a custom cap', () => {
    expect(pruneAndRank(many, { maxNodes: 5 }).nodes).toHaveLength(5);
  });

  it('reports a histogram', () => {
    const r = pruneAndRank([
      candidate({ id: 0, text: 'a', visible: false }),
      candidate({ id: 1, role: 'btn', clickable: true, text: 'b' }),
    ]);
    expect(formatPruneStats(r.stats)).toBe('2->1 (50% kept) invisible:1');
  });

  it('survives an empty screen', () => {
    const r = pruneAndRank([]);
    expect(r.nodes).toHaveLength(0);
    expect(r.stats.before).toBe(0);
  });
});

describe('interactive-first ranking (measured on real sites)', () => {
  // On a Wikipedia article, ranking by area alone gave 14 clickable nodes out of
  // 40 — the biggest elements on a dense page are layout wrappers, so the agent
  // was shown page chrome instead of controls.
  it('keeps interactive nodes over larger non-interactive ones when the cap binds', () => {
    const candidates = [
      // Ten huge wrappers that would each out-rank a button on area alone.
      ...Array.from({ length: 10 }, (_, i) =>
        candidate({ id: i, role: 'text', text: `wrapper ${i}`, bounds: bounds(0, i, 900, 900) }),
      ),
      // Five small buttons, which are the only things worth acting on.
      ...Array.from({ length: 5 }, (_, i) =>
        candidate({ id: 10 + i, role: 'btn', text: `Add ${i}`, clickable: true, bounds: bounds(0, i, 60, 30) }),
      ),
    ];
    const r = pruneAndRank(candidates, { maxNodes: 5 });
    expect(r.nodes).toHaveLength(5);
    expect(r.nodes.every((n) => n.clickable)).toBe(true);
  });

  it('still prefers the larger of two interactive nodes', () => {
    const r = pruneAndRank(
      [
        candidate({ id: 0, role: 'btn', text: 'small', clickable: true, bounds: bounds(0, 0, 20, 20) }),
        candidate({ id: 1, role: 'btn', text: 'large', clickable: true, bounds: bounds(0, 30, 300, 80) }),
      ],
      { maxNodes: 1 },
    );
    expect(r.nodes[0]?.text).toBe('large');
  });

  it('changes nothing when the cap does not bind — every Tiffin screen', () => {
    const candidates = [
      candidate({ id: 0, role: 'text', text: 'heading', bounds: bounds(0, 0, 400, 300) }),
      candidate({ id: 1, role: 'btn', text: 'Add', clickable: true, bounds: bounds(0, 320, 60, 30) }),
    ];
    const r = pruneAndRank(candidates);
    // Traversal order is restored after ranking, so presentation is unchanged.
    expect(r.nodes.map((n) => n.text)).toEqual(['heading', 'Add']);
  });
});
