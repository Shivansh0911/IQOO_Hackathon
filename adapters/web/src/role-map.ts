/**
 * Tag + ARIA role -> the core role vocabulary.
 *
 * Pure and total, so it is unit-testable without a DOM. This is the file with
 * an exact Android counterpart: there, the same eight roles come from
 * AccessibilityNodeInfo.className. Everything above the adapter sees only the
 * vocabulary, never the tag name, which is why one planner prompt works on both
 * platforms.
 */

import type { Role } from '@origo/core';

/** Explicit ARIA wins over the tag, because the author said what they meant. */
const ARIA_TO_ROLE: Readonly<Record<string, Role>> = {
  button: 'btn',
  link: 'btn',
  menuitem: 'btn',
  option: 'btn',
  textbox: 'edit',
  searchbox: 'edit',
  combobox: 'edit',
  spinbutton: 'edit',
  checkbox: 'switch',
  radio: 'switch',
  switch: 'switch',
  tab: 'tab',
  list: 'list',
  listbox: 'list',
  menu: 'list',
  grid: 'list',
  table: 'list',
  img: 'img',
  image: 'img',
  figure: 'img',
  heading: 'text',
  paragraph: 'text',
  status: 'text',
  alert: 'text',
  tooltip: 'text',
};

const TAG_TO_ROLE: Readonly<Record<string, Role>> = {
  button: 'btn',
  a: 'btn',
  summary: 'btn',
  textarea: 'edit',
  select: 'edit',
  ul: 'list',
  ol: 'list',
  dl: 'list',
  table: 'list',
  img: 'img',
  svg: 'img',
  picture: 'img',
  video: 'img',
  canvas: 'img',
  h1: 'text',
  h2: 'text',
  h3: 'text',
  h4: 'text',
  h5: 'text',
  h6: 'text',
  p: 'text',
  span: 'text',
  label: 'text',
  li: 'text',
  td: 'text',
  th: 'text',
  strong: 'text',
  em: 'text',
  small: 'text',
  figcaption: 'text',
  legend: 'text',
};

/** <input> is eight controls wearing one tag. */
const INPUT_TYPE_TO_ROLE: Readonly<Record<string, Role>> = {
  checkbox: 'switch',
  radio: 'switch',
  button: 'btn',
  submit: 'btn',
  reset: 'btn',
  image: 'btn',
  file: 'btn',
  range: 'other',
  color: 'other',
  hidden: 'other',
};

export function mapRole(input: {
  readonly tag: string;
  readonly ariaRole?: string | null;
  readonly inputType?: string | null;
  readonly contentEditable?: boolean;
}): Role {
  const aria = input.ariaRole?.trim().toLowerCase();
  if (aria) {
    const first = aria.split(/\s+/)[0];
    if (first && first in ARIA_TO_ROLE) return ARIA_TO_ROLE[first] as Role;
  }

  const tag = input.tag.toLowerCase();

  if (tag === 'input') {
    const type = (input.inputType ?? 'text').toLowerCase();
    return (INPUT_TYPE_TO_ROLE[type] as Role | undefined) ?? 'edit';
  }

  if (input.contentEditable === true) return 'edit';
  return (TAG_TO_ROLE[tag] as Role | undefined) ?? 'other';
}
