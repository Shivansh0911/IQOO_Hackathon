import { describe, expect, it } from 'vitest';
import { MAX_WAIT_MS } from '../src/action.js';
import { extractFirstJsonObject, validateModelOutput } from '../src/validation.js';
import type { ValidationContext } from '../src/validation.js';
import { node, screen } from './fixtures.js';

/**
 * A representative screen: a search field, a clickable card, a scrollable list,
 * a disabled button, and a total.
 */
const SCREEN = screen(
  [
    node({ index: 0, role: 'edit', text: 'Search restaurants', editable: true }),
    node({ index: 1, role: 'btn', text: 'Paradise Biryani 4.4', clickable: true }),
    node({ index: 2, role: 'list', text: '', scrollable: true }),
    node({ index: 3, role: 'btn', text: 'Place order', clickable: true }),
    node({ index: 4, role: 'btn', text: 'Apply coupon', clickable: true, enabled: false }),
    node({ index: 5, role: 'text', text: 'Total ₹1,240' }),
  ],
  [2],
);

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  screen: SCREEN,
  passedAsserts: 0,
  ...over,
});

describe('stage 1 — extraction', () => {
  it('accepts a bare object', () => {
    const r = extractFirstJsonObject('{"type":"Tap","node":1,"reason":"open"}');
    expect(r.ok && r.value).toBe('{"type":"Tap","node":1,"reason":"open"}');
  });

  it('strips markdown fences', () => {
    const r = extractFirstJsonObject('```json\n{"type":"Tap","node":1,"reason":"open"}\n```');
    expect(r.ok && JSON.parse(r.value)).toMatchObject({ type: 'Tap', node: 1 });
  });

  it('strips prose before and after', () => {
    const raw = 'Sure! I will tap the first card.\n{"type":"Tap","node":1,"reason":"open"}\nLet me know if that helps.';
    const r = extractFirstJsonObject(raw);
    expect(r.ok && JSON.parse(r.value)).toMatchObject({ type: 'Tap', node: 1 });
  });

  it('takes only the first object when the model emits two', () => {
    const r = extractFirstJsonObject('{"type":"Tap","node":1,"reason":"a"} {"type":"Tap","node":2,"reason":"b"}');
    expect(r.ok && JSON.parse(r.value)).toMatchObject({ node: 1 });
  });

  it('is not confused by braces inside a string', () => {
    const r = extractFirstJsonObject('{"type":"TypeText","node":0,"text":"biryani {spicy}","reason":"search"}');
    expect(r.ok && JSON.parse(r.value)).toMatchObject({ text: 'biryani {spicy}' });
  });

  it('rejects prose with no JSON at all, with a feedable message', () => {
    const r = extractFirstJsonObject('I think you should tap the first restaurant.');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.stage).toBe('extract');
    expect(r.error.fault).toBe('malformed-output');
    expect(r.error.message).toMatch(/exactly one JSON object/);
  });

  it('rejects an unterminated object', () => {
    const r = extractFirstJsonObject('{"type":"Tap","node":1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/never closed/);
  });
});

describe('stage 2 — schema', () => {
  it('rejects malformed JSON', () => {
    const r = validateModelOutput('{"type":"Tap","node":1,}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.stage).toBe('extract');
      expect(r.error.fault).toBe('malformed-output');
    }
  });

  it('rejects an unknown action type and lists the legal ones', () => {
    const r = validateModelOutput('{"type":"Swipe","node":1,"reason":"x"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.stage).toBe('schema');
      expect(r.error.message).toMatch(/Tap, TypeText, Scroll, PressKey, Wait, Assert, Finish/);
    }
  });

  it('rejects an invented extra field rather than ignoring it', () => {
    const r = validateModelOutput('{"type":"Tap","node":1,"reason":"x","selector":".card"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/selector/);
  });

  it('rejects a missing reason', () => {
    const r = validateModelOutput('{"type":"Tap","node":1}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.stage).toBe('schema');
  });

  it('rejects a non-integer node index', () => {
    const r = validateModelOutput('{"type":"Tap","node":1.5,"reason":"x"}', ctx());
    expect(r.ok).toBe(false);
  });
});

describe('stage 3 — semantics against the screen the model was shown', () => {
  it('rejects an out-of-range index and names the valid range', () => {
    const r = validateModelOutput('{"type":"Tap","node":99,"reason":"x"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.stage).toBe('semantic');
      expect(r.error.fault).toBe('invalid-for-screen');
      expect(r.error.message).toMatch(/Valid indices are 0 to 5/);
    }
  });

  it('rejects a Tap on something that is not clickable', () => {
    const r = validateModelOutput('{"type":"Tap","node":5,"reason":"x"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/not clickable/);
  });

  it('rejects a Tap on a disabled node', () => {
    const r = validateModelOutput('{"type":"Tap","node":4,"reason":"x"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/disabled/);
  });

  it('rejects TypeText into a node that is not editable', () => {
    const r = validateModelOutput('{"type":"TypeText","node":1,"text":"hi","reason":"x"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/not a text field/);
  });

  it('accepts TypeText into the search field', () => {
    const r = validateModelOutput('{"type":"TypeText","node":0,"text":"biryani","reason":"search"}', ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.target?.index).toBe(0);
  });

  it('rejects Scroll on a node that is not scrollable, and names the ones that are', () => {
    const r = validateModelOutput('{"type":"Scroll","node":1,"direction":"down","reason":"x"}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/scrollable here: 2/);
  });

  it('accepts Scroll on the list', () => {
    const r = validateModelOutput('{"type":"Scroll","node":2,"direction":"down","reason":"more"}', ctx());
    expect(r.ok).toBe(true);
  });

  it('reports no-nodes honestly on an empty screen', () => {
    const r = validateModelOutput('{"type":"Tap","node":0,"reason":"x"}', { screen: screen([]), passedAsserts: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/no nodes on this screen/);
  });
});

describe('the Wait cap — enforced by the validator, not the model', () => {
  it('clamps an over-long wait and records the adjustment', () => {
    const r = validateModelOutput('{"type":"Wait","maxMs":60000,"reason":"loading"}', ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toMatchObject({ type: 'Wait', maxMs: MAX_WAIT_MS });
    expect(r.value.adjustments).toHaveLength(1);
    expect(r.value.adjustments[0]).toMatchObject({ field: 'maxMs', from: '60000', to: '5000' });
  });

  it('leaves a reasonable wait alone', () => {
    const r = validateModelOutput('{"type":"Wait","maxMs":800,"reason":"loading"}', ctx());
    expect(r.ok && r.value.adjustments).toHaveLength(0);
  });

  it('rejects a zero or negative wait', () => {
    expect(validateModelOutput('{"type":"Wait","maxMs":0,"reason":"x"}', ctx()).ok).toBe(false);
  });
});

describe('the Assert rule — a run that verified nothing cannot Pass', () => {
  it('downgrades Finish(Pass) to Blocked when no Assert has passed', () => {
    const r = validateModelOutput('{"type":"Finish","verdict":"Pass","reason":"done"}', ctx({ passedAsserts: 0 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toMatchObject({ type: 'Finish', verdict: 'Blocked' });
    expect(r.value.adjustments[0]?.why).toMatch(/no expectation was verified/);
  });

  it('allows Finish(Pass) once an Assert has passed', () => {
    const r = validateModelOutput('{"type":"Finish","verdict":"Pass","reason":"done"}', ctx({ passedAsserts: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toMatchObject({ verdict: 'Pass' });
    expect(r.value.adjustments).toHaveLength(0);
  });

  it('never touches Finish(Fail) or Finish(Blocked)', () => {
    for (const verdict of ['Fail', 'Blocked']) {
      const r = validateModelOutput(`{"type":"Finish","verdict":"${verdict}","reason":"x"}`, ctx());
      expect(r.ok && r.value.action).toMatchObject({ verdict });
      expect(r.ok && r.value.adjustments).toHaveLength(0);
    }
  });
});

describe('stage 4 — the destructive gate', () => {
  it('flags a Tap on "Place order" and suspends for confirmation', () => {
    const r = validateModelOutput('{"type":"Tap","node":3,"reason":"checkout"}', ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.requiresConfirmation).toBe(true);
    expect(r.value.destructiveMatch).toBe('order');
  });

  it('does not flag an ordinary tap', () => {
    const r = validateModelOutput('{"type":"Tap","node":1,"reason":"open restaurant"}', ctx());
    expect(r.ok && r.value.requiresConfirmation).toBe(false);
  });

  it('matches on word boundaries, so "Preordered" does not trip "order"', () => {
    const s = screen([node({ index: 0, role: 'btn', text: 'Preordered meals', clickable: true })]);
    const r = validateModelOutput('{"type":"Tap","node":0,"reason":"x"}', { screen: s, passedAsserts: 0 });
    expect(r.ok && r.value.requiresConfirmation).toBe(false);
  });

  it('honours a caller-supplied pattern list', () => {
    const r = validateModelOutput('{"type":"Tap","node":1,"reason":"x"}', ctx({ destructivePatterns: ['biryani'] }));
    expect(r.ok && r.value.destructiveMatch).toBe('biryani');
  });
});

describe('the pipeline never coerces', () => {
  it('returns Err rather than substituting a default action', () => {
    for (const bad of ['', 'null', '{}', '[]', '{"type":null}', '{"action":"tap"}']) {
      const r = validateModelOutput(bad, ctx());
      expect(r.ok, `expected rejection for ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});
