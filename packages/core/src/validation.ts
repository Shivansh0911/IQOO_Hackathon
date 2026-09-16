/**
 * The validation pipeline. Nothing reaches a live UI without passing all of it.
 *
 *   raw text -> extract first {...}  (strip fences and prose)
 *            -> Zod parse, strict
 *            -> semantic checks against the screen the model was actually shown
 *            -> destructive-pattern policy
 *            -> execute
 *
 * Every failure produces a SPECIFIC, FEEDABLE message that goes straight back
 * into the next prompt. We never coerce, never guess, never substitute a default
 * action. A rejected action is a retry; two consecutive retries end the run as
 * Blocked. That is the whole safety story, and it only works because the model
 * addresses nodes by an index we assigned.
 */

import { z } from 'zod';
import type { Action } from './action.js';
import { ACTION_TYPES, ActionSchema, MAX_WAIT_MS } from './action.js';
import type { Result } from './result.js';
import { attempt, describeThrown, err, ok } from './result.js';
import type { ScreenState, UiNode } from './screen-state.js';
import { nodeAt } from './screen-state.js';

/**
 * Which stage rejected the action.
 *
 * The report distinguishes "the model produced nonsense" (extract/schema) from
 * "the model produced a well-formed action that does not fit this screen"
 * (semantic). They are different bugs with different fixes — one is a prompt
 * problem, the other is usually a pruning problem — and conflating them wastes
 * time we will not have on site.
 */
export type ValidationStage = 'extract' | 'schema' | 'semantic' | 'policy';

export type ValidationFault = 'malformed-output' | 'invalid-for-screen';

export interface ValidationError {
  readonly stage: ValidationStage;
  readonly fault: ValidationFault;
  /** Fed verbatim into the next prompt as the correction instruction. */
  readonly message: string;
  /** The raw model text, kept for the report. Truncated for sanity. */
  readonly raw?: string;
}

/** A change the validator made to an otherwise-valid action, always surfaced. */
export interface Adjustment {
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly why: string;
}

export interface ValidatedAction {
  readonly action: Action;
  /** Resolved target, if the action addresses a node. Saves every caller a lookup. */
  readonly target: UiNode | null;
  /** Non-empty when the validator clamped or downgraded something. Shown in the report. */
  readonly adjustments: readonly Adjustment[];
  /** Set when the destructive gate matched. The agent must suspend and ask. */
  readonly requiresConfirmation: boolean;
  readonly destructiveMatch: string | null;
}

/**
 * Destructive patterns. Matched against the target node's text and description.
 * Configurable, because a different target app has different dangerous verbs.
 */
export const DEFAULT_DESTRUCTIVE_PATTERNS: readonly string[] = [
  'pay',
  'purchase',
  'order',
  'checkout',
  'place order',
  'delete',
  'remove',
  'share',
  'send',
  'confirm',
];

export interface ValidationContext {
  readonly screen: ScreenState;
  /** How many Asserts have passed so far this run. Drives the Finish(Pass) downgrade. */
  readonly passedAsserts: number;
  /**
   * How many Asserts have FAILED so far. A run that checked something and found
   * it wrong is a Fail, not a Blocked — and small models will happily assert,
   * watch the assertion fail, and finish Pass anyway.
   */
  readonly failedAsserts?: number;
  readonly destructivePatterns?: readonly string[];
}

const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/;

/**
 * Pulls the first balanced {...} out of whatever the model produced.
 *
 * Small models wrap JSON in prose, in markdown fences, in both, and sometimes
 * emit a second object after the first. We take the first balanced object and
 * ignore everything else; brace counting is string-aware so a `{` inside a
 * search query does not throw the count off.
 */
export function extractFirstJsonObject(raw: string): Result<string, ValidationError> {
  const fenced = FENCE.exec(raw);
  const haystack = fenced?.[1] ?? raw;
  const start = haystack.indexOf('{');
  if (start === -1) {
    return err({
      stage: 'extract',
      fault: 'malformed-output',
      message: 'Your reply contained no JSON object. Reply with exactly one JSON object and no other text.',
      raw: raw.slice(0, 400),
    });
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i += 1) {
    const ch = haystack[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return ok(haystack.slice(start, i + 1));
    }
  }

  return err({
    stage: 'extract',
    fault: 'malformed-output',
    message: 'Your JSON object was never closed. Reply with exactly one complete JSON object.',
    raw: raw.slice(0, 400),
  });
}

function schemaMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'The action did not match the required shape.';
  const path = first.path.join('.');
  if (first.code === 'invalid_union_discriminator' || (path === 'type' && first.code === 'invalid_literal')) {
    return `"type" must be exactly one of ${ACTION_TYPES.join(', ')}.`;
  }
  if (first.code === 'unrecognized_keys') {
    return `Unknown field(s) ${first.keys.map((k) => `"${k}"`).join(', ')}. Use only the fields listed for that action type.`;
  }
  return path ? `Field "${path}": ${first.message}.` : `${first.message}.`;
}

/**
 * The full pipeline. `raw` is whatever the planner returned, unexamined.
 */
export function validateModelOutput(raw: string, ctx: ValidationContext): Result<ValidatedAction, ValidationError> {
  const extracted = extractFirstJsonObject(raw);
  if (!extracted.ok) return extracted;

  const parsedJson = attempt(
    () => JSON.parse(extracted.value) as unknown,
    (cause) => ({
      stage: 'extract' as const,
      fault: 'malformed-output' as const,
      message: `That was not valid JSON (${describeThrown(cause)}). Reply with exactly one JSON object.`,
      raw: extracted.value.slice(0, 400),
    }),
  );
  if (!parsedJson.ok) return parsedJson;

  const schema = ActionSchema.safeParse(parsedJson.value);
  if (!schema.success) {
    return err({
      stage: 'schema',
      fault: 'malformed-output',
      message: schemaMessage(schema.error),
      raw: extracted.value.slice(0, 400),
    });
  }

  return applySemantics(schema.data, ctx, extracted.value);
}

/** Stages 3 and 4, split out so tests can drive them with an already-typed Action. */
export function applySemantics(
  action: Action,
  ctx: ValidationContext,
  raw?: string,
): Result<ValidatedAction, ValidationError> {
  const { screen } = ctx;
  const adjustments: Adjustment[] = [];
  const reject = (message: string): Result<ValidatedAction, ValidationError> =>
    err(
      raw === undefined
        ? { stage: 'semantic', fault: 'invalid-for-screen', message }
        : { stage: 'semantic', fault: 'invalid-for-screen', message, raw: raw.slice(0, 400) },
    );

  let target: UiNode | null = null;
  if ('node' in action) {
    const found = nodeAt(screen, action.node);
    if (!found) {
      const highest = screen.nodes.length - 1;
      return reject(
        screen.nodes.length === 0
          ? 'There are no nodes on this screen, so no node index is valid.'
          : `Node ${action.node} does not exist. Valid indices are 0 to ${highest}. Choose one from the list you were given.`,
      );
    }
    if (!found.enabled) {
      return reject(`Node ${action.node} is disabled and cannot be acted on. Choose a different node.`);
    }
    target = found;
  }

  switch (action.type) {
    case 'Tap':
      if (target && !target.clickable) {
        return reject(
          `Node ${action.node} is not clickable (role "${target.role}"). Tap only nodes marked "clk":1.`,
        );
      }
      break;

    case 'TypeText':
      if (target && !target.editable) {
        return reject(
          `Node ${action.node} is not a text field (role "${target.role}"). TypeText only into nodes marked "ed":1.`,
        );
      }
      break;

    case 'Scroll': {
      const declared = screen.scrollable.includes(action.node);
      if (target && !target.scrollable && !declared) {
        return reject(
          `Node ${action.node} is not scrollable. Scroll only nodes marked "scr":1${
            screen.scrollable.length > 0 ? ` (scrollable here: ${screen.scrollable.join(', ')})` : ''
          }.`,
        );
      }
      break;
    }

    case 'Wait':
      if (action.maxMs > MAX_WAIT_MS) {
        // Clamped, not rejected: a bound on a delay is not a choice of action, and
        // stalling the run to argue about it helps nobody. It is recorded so the
        // report shows exactly what the model asked for and what it got.
        adjustments.push({
          field: 'maxMs',
          from: String(action.maxMs),
          to: String(MAX_WAIT_MS),
          why: `waits are capped at ${MAX_WAIT_MS}ms by the validator`,
        });
        action = { ...action, maxMs: MAX_WAIT_MS };
      }
      break;

    case 'Finish':
      // THE ASSERT RULE, in one place. Enforced here rather than in the prompt,
      // because a prompt is a request and this is a guarantee.
      //
      // Order matters, and it is the order a tester would use:
      //   checked something and it was wrong  -> Fail   (the informative answer)
      //   checked nothing at all              -> Blocked (a walkthrough, not a test)
      if (action.verdict === 'Pass' && (ctx.failedAsserts ?? 0) > 0) {
        adjustments.push({
          field: 'verdict',
          from: 'Pass',
          to: 'Fail',
          why: `an expectation was checked and did not hold (${ctx.failedAsserts} failed)`,
        });
        action = {
          ...action,
          verdict: 'Fail',
          reason: `an expectation was checked and did not hold (${ctx.failedAsserts} failed)`,
        };
      } else if (action.verdict === 'Pass' && ctx.passedAsserts === 0) {
        adjustments.push({
          field: 'verdict',
          from: 'Pass',
          to: 'Blocked',
          why: 'no expectation was verified: a run with zero passed Asserts cannot Pass',
        });
        action = { ...action, verdict: 'Blocked', reason: 'no expectation was verified' };
      }
      break;

    case 'PressKey':
    case 'Assert':
      break;
  }

  const patterns = ctx.destructivePatterns ?? DEFAULT_DESTRUCTIVE_PATTERNS;
  const destructiveMatch = action.type === 'Tap' && target ? matchDestructive(target, patterns) : null;

  return ok({
    action,
    target,
    adjustments,
    requiresConfirmation: destructiveMatch !== null,
    destructiveMatch,
  });
}

/**
 * Word-boundary match, so "Remove" flags and "Removed 2 items" flags, but
 * "Preorder" does not trip on "order" and a restaurant called "Sendhwa" does
 * not trip on "send".
 */
export function matchDestructive(node: UiNode, patterns: readonly string[]): string | null {
  const haystack = `${node.text} ${node.desc}`.toLowerCase();
  for (const pattern of patterns) {
    const escaped = pattern.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'u').test(haystack)) return pattern;
  }
  return null;
}
