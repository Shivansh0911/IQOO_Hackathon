import { describe, expect, it } from 'vitest';
import { mapRole } from '../src/role-map.js';

describe('mapRole — pure, and the file with an exact Android counterpart', () => {
  it('maps the obvious tags', () => {
    expect(mapRole({ tag: 'button' })).toBe('btn');
    expect(mapRole({ tag: 'a' })).toBe('btn');
    expect(mapRole({ tag: 'textarea' })).toBe('edit');
    expect(mapRole({ tag: 'ul' })).toBe('list');
    expect(mapRole({ tag: 'img' })).toBe('img');
    expect(mapRole({ tag: 'h2' })).toBe('text');
    expect(mapRole({ tag: 'span' })).toBe('text');
    expect(mapRole({ tag: 'div' })).toBe('other');
  });

  it('resolves <input> by its type', () => {
    expect(mapRole({ tag: 'input', inputType: 'text' })).toBe('edit');
    expect(mapRole({ tag: 'input', inputType: 'search' })).toBe('edit');
    expect(mapRole({ tag: 'input', inputType: 'email' })).toBe('edit');
    expect(mapRole({ tag: 'input', inputType: 'checkbox' })).toBe('switch');
    expect(mapRole({ tag: 'input', inputType: 'radio' })).toBe('switch');
    expect(mapRole({ tag: 'input', inputType: 'submit' })).toBe('btn');
    expect(mapRole({ tag: 'input', inputType: 'range' })).toBe('other');
  });

  it('lets an explicit ARIA role win over the tag, because the author said what they meant', () => {
    expect(mapRole({ tag: 'div', ariaRole: 'button' })).toBe('btn');
    expect(mapRole({ tag: 'div', ariaRole: 'searchbox' })).toBe('edit');
    expect(mapRole({ tag: 'span', ariaRole: 'tab' })).toBe('tab');
    expect(mapRole({ tag: 'button', ariaRole: 'switch' })).toBe('switch');
    expect(mapRole({ tag: 'div', ariaRole: 'list' })).toBe('list');
  });

  it('handles a role token list by taking the first', () => {
    expect(mapRole({ tag: 'div', ariaRole: 'button link' })).toBe('btn');
  });

  it('treats contenteditable as a text field', () => {
    expect(mapRole({ tag: 'div', contentEditable: true })).toBe('edit');
  });

  it('is case-insensitive and tolerant of whitespace', () => {
    expect(mapRole({ tag: 'BUTTON' })).toBe('btn');
    expect(mapRole({ tag: 'div', ariaRole: '  Button ' })).toBe('btn');
  });

  it('falls back to "other" for an unknown role or tag rather than inventing one', () => {
    expect(mapRole({ tag: 'marquee' })).toBe('other');
    expect(mapRole({ tag: 'div', ariaRole: 'doc-appendix' })).toBe('other');
  });

  it('is total: never throws, never returns undefined', () => {
    for (const tag of ['', 'x', 'INPUT', 'svg', 'canvas']) {
      expect(typeof mapRole({ tag })).toBe('string');
    }
  });
});
