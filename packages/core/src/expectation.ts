/**
 * Assert evaluation — deterministic, and deliberately not an LLM call.
 *
 * A test framework whose pass/fail verdict is itself a model opinion is not a
 * test framework. `expect` is a tiny, total grammar evaluated in code against
 * the POST-action screen state, so the verdict in the report is reproducible and
 * arguable from the evidence.
 *
 * GRAMMAR (documented verbatim in the planner prompt, so the model knows it):
 *   "Cart"        substring, case-insensitive          -> passes if the node says it
 *   "!Sold out"   negated substring                    -> passes if the node does NOT say it
 *   "<500"        numeric, against the first number in the node's text
 *   "<=500" ">4" ">=4.0" "=2"                          -> the rest of the comparisons
 *
 * Currency symbols, commas and spaces are stripped before a numeric compare, so
 * "Total ₹1,240" reads as 1240.
 */

import type { UiNode } from './screen-state.js';

export type ExpectationKind = 'substring' | 'not-substring' | 'numeric';

export interface ExpectationOutcome {
  readonly passed: boolean;
  readonly kind: ExpectationKind;
  /** Human sentence for the step log and the report. Always states what was actually seen. */
  readonly detail: string;
  readonly observed: string;
  readonly expected: string;
}

const NUMERIC = /^(<=|>=|<|>|==|=)\s*(-?\d+(?:\.\d+)?)$/;

/** Everything the node says, from the model's point of view. */
export function observedText(node: UiNode): string {
  return [node.text, node.desc].filter(Boolean).join(' ').trim();
}

/** First number in a string, tolerant of ₹, commas and spacing. */
export function firstNumber(text: string): number | null {
  const cleaned = text.replace(/[₹$€£]/g, '').replace(/(\d),(?=\d{2,3}\b)/g, '$1');
  const match = /-?\d+(?:\.\d+)?/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

export function evaluateExpectation(expect: string, node: UiNode): ExpectationOutcome {
  const observed = observedText(node);
  const trimmed = expect.trim();

  const numeric = NUMERIC.exec(trimmed);
  if (numeric) {
    const operator = numeric[1] as string;
    const target = Number(numeric[2]);
    const actual = firstNumber(observed);
    if (actual === null) {
      return {
        passed: false,
        kind: 'numeric',
        observed,
        expected: trimmed,
        detail: `node ${node.index} has no number to compare; it reads "${observed}"`,
      };
    }
    const passed =
      operator === '<' ? actual < target
      : operator === '<=' ? actual <= target
      : operator === '>' ? actual > target
      : operator === '>=' ? actual >= target
      : actual === target;
    return {
      passed,
      kind: 'numeric',
      observed,
      expected: trimmed,
      detail: `node ${node.index} reads ${actual}; expected ${operator} ${target}`,
    };
  }

  if (trimmed.startsWith('!')) {
    const needle = trimmed.slice(1).trim().toLowerCase();
    const present = observed.toLowerCase().includes(needle);
    return {
      passed: !present,
      kind: 'not-substring',
      observed,
      expected: trimmed,
      detail: present
        ? `node ${node.index} still contains "${needle}"`
        : `node ${node.index} does not contain "${needle}"`,
    };
  }

  const needle = trimmed.toLowerCase();
  const present = observed.toLowerCase().includes(needle);
  return {
    passed: present,
    kind: 'substring',
    observed,
    expected: trimmed,
    detail: present
      ? `node ${node.index} contains "${trimmed}"`
      : `node ${node.index} reads "${observed}", which does not contain "${trimmed}"`,
  };
}
