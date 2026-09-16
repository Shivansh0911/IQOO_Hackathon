import { describe, expect, it } from 'vitest';
import { evaluateExpectation, firstNumber } from '../src/expectation.js';
import { node } from './fixtures.js';

describe('substring expectations', () => {
  it('passes when the node says it, case-insensitively', () => {
    const r = evaluateExpectation('cart', node({ index: 0, text: 'Cart (1 item)' }));
    expect(r.passed).toBe(true);
    expect(r.kind).toBe('substring');
  });

  it('fails and reports what was actually seen', () => {
    const r = evaluateExpectation('Cart (2 items)', node({ index: 3, text: 'Cart (1 item)' }));
    expect(r.passed).toBe(false);
    expect(r.detail).toBe('node 3 reads "Cart (1 item)", which does not contain "Cart (2 items)"');
  });

  it('reads the accessible description too', () => {
    const r = evaluateExpectation('Clear', node({ index: 0, text: '', desc: 'Clear search' }));
    expect(r.passed).toBe(true);
  });
});

describe('negated expectations', () => {
  it('passes when the text is absent', () => {
    expect(evaluateExpectation('!Sold out', node({ index: 0, text: 'Add to cart' })).passed).toBe(true);
  });

  it('fails when the text is present', () => {
    const r = evaluateExpectation('!Sold out', node({ index: 0, text: 'Sold out' }));
    expect(r.passed).toBe(false);
    expect(r.kind).toBe('not-substring');
  });
});

describe('numeric expectations — how "total under ₹500" is actually checked', () => {
  it('parses rupees and Indian digit grouping', () => {
    expect(firstNumber('Total ₹1,240')).toBe(1240);
    expect(firstNumber('₹29 delivery')).toBe(29);
    expect(firstNumber('4.4 ★')).toBe(4.4);
    expect(firstNumber('no numbers here')).toBeNull();
  });

  it('passes a < comparison', () => {
    const r = evaluateExpectation('<500', node({ index: 7, text: 'Total ₹432' }));
    expect(r.passed).toBe(true);
    expect(r.detail).toBe('node 7 reads 432; expected < 500');
  });

  it('fails a < comparison and says both numbers', () => {
    const r = evaluateExpectation('<500', node({ index: 7, text: 'Total ₹1,240' }));
    expect(r.passed).toBe(false);
    expect(r.detail).toBe('node 7 reads 1240; expected < 500');
  });

  it('supports <=, >, >= and =', () => {
    const n = node({ index: 0, text: '4.4' });
    expect(evaluateExpectation('>=4.0', n).passed).toBe(true);
    expect(evaluateExpectation('>4.5', n).passed).toBe(false);
    expect(evaluateExpectation('<=4.4', n).passed).toBe(true);
    expect(evaluateExpectation('=4.4', n).passed).toBe(true);
  });

  it('fails honestly when the node has no number at all', () => {
    const r = evaluateExpectation('<500', node({ index: 2, text: 'Your cart is empty' }));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/no number to compare/);
  });

  it('treats a stray angle bracket in prose as a substring, not a comparison', () => {
    const r = evaluateExpectation('< back', node({ index: 0, text: '< back to results' }));
    expect(r.kind).toBe('substring');
    expect(r.passed).toBe(true);
  });
});
