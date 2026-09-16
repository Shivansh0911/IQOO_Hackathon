/**
 * The seven actions. This union is the entire vocabulary the model has.
 *
 * Every field is part of the contract and every field is checkable. There is no
 * free-form `params` object, because anything unstructured is something the
 * validator cannot check, and anything the validator cannot check is something
 * that reaches a live UI unexamined.
 *
 * `node` is always an index into the node list the model was just shown
 * (CLAUDE.md constraint 4). Never a selector, never a coordinate, never a text
 * matcher. A hallucinated index is provably out of range, so the worst outcome
 * of a hallucination is a retry, not a wrong tap.
 */

import { z } from 'zod';

/** A Wait longer than this is always the model stalling, never a real need. */
export const MAX_WAIT_MS = 5000;

/** Short model-supplied justification. Becomes the step label in the report. */
const reason = z.string().min(1).max(200);
const nodeIndex = z.number().int().nonnegative();

export const ScrollDirection = z.enum(['up', 'down', 'left', 'right']);
export type ScrollDirection = z.infer<typeof ScrollDirection>;

export const PressableKey = z.enum(['Back', 'Home', 'Enter']);
export type PressableKey = z.infer<typeof PressableKey>;

export const Verdict = z.enum(['Pass', 'Fail', 'Blocked']);
export type Verdict = z.infer<typeof Verdict>;

/**
 * `.strict()` everywhere: an unknown key means the model invented a field, and
 * an invented field is a signal worth surfacing as a retry rather than ignoring.
 */
export const TapAction = z.object({ type: z.literal('Tap'), node: nodeIndex, reason }).strict();
export const TypeTextAction = z
  .object({ type: z.literal('TypeText'), node: nodeIndex, text: z.string().max(200), reason })
  .strict();
export const ScrollAction = z
  .object({ type: z.literal('Scroll'), node: nodeIndex, direction: ScrollDirection, reason })
  .strict();
export const PressKeyAction = z.object({ type: z.literal('PressKey'), key: PressableKey, reason }).strict();
export const WaitAction = z
  .object({ type: z.literal('Wait'), maxMs: z.number().int().positive(), reason })
  .strict();
export const AssertAction = z
  .object({ type: z.literal('Assert'), node: nodeIndex, expect: z.string().min(1).max(120), reason })
  .strict();
export const FinishAction = z.object({ type: z.literal('Finish'), verdict: Verdict, reason }).strict();

export const ActionSchema = z.discriminatedUnion('type', [
  TapAction,
  TypeTextAction,
  ScrollAction,
  PressKeyAction,
  WaitAction,
  AssertAction,
  FinishAction,
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];

export const ACTION_TYPES: readonly ActionType[] = [
  'Tap',
  'TypeText',
  'Scroll',
  'PressKey',
  'Wait',
  'Assert',
  'Finish',
] as const;

/** Actions that address a node. Used by the semantic checks and the highlight ring. */
export type NodeTargetedAction = Extract<Action, { node: number }>;

export function targetsNode(action: Action): action is NodeTargetedAction {
  return 'node' in action;
}

/** One-line form for the step log and the report. Deterministic. */
export function formatAction(action: Action): string {
  switch (action.type) {
    case 'Tap':
      return `Tap(${action.node})`;
    case 'TypeText':
      return `TypeText(${action.node}, ${JSON.stringify(action.text)})`;
    case 'Scroll':
      return `Scroll(${action.node}, ${action.direction})`;
    case 'PressKey':
      return `PressKey(${action.key})`;
    case 'Wait':
      return `Wait(${action.maxMs}ms)`;
    case 'Assert':
      return `Assert(${action.node}, ${JSON.stringify(action.expect)})`;
    case 'Finish':
      return `Finish(${action.verdict})`;
  }
}

export const ACTION_GLYPHS: Readonly<Record<ActionType, string>> = {
  Tap: '◉',
  TypeText: '⌨',
  Scroll: '↕',
  PressKey: '↵',
  Wait: '◷',
  Assert: '✓',
  Finish: '■',
};
