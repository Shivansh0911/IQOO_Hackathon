/**
 * Verifies the two architectural lint rules actually fire.
 *
 * A lint rule nobody tests is a comment. This lints the fixtures in
 * tooling/boundary-fixtures and asserts, per file, exactly which rule ids must
 * report — and that the clean fixtures report nothing. Exit code 1 on any
 * mismatch, so `pnpm verify` and CI fail if a boundary is ever weakened.
 */
import { ESLint } from 'eslint';
import path from 'node:path';
import process from 'node:process';

/** @type {{ file: string, expect: string[], why: string }[]} */
const CASES = [
  {
    file: 'tooling/boundary-fixtures/core/violation-web-import.ts',
    expect: ['no-restricted-imports'],
    why: 'RULE A — portable zone importing React',
  },
  {
    file: 'tooling/boundary-fixtures/core/violation-dom-global.ts',
    expect: ['no-restricted-globals'],
    why: 'RULE A — portable zone touching document/window/localStorage',
  },
  {
    file: 'tooling/boundary-fixtures/core/clean.ts',
    expect: [],
    why: 'RULE A — platform-agnostic code stays clean',
  },
  {
    file: 'tooling/boundary-fixtures/tiffin/violation-origo-import.ts',
    expect: ['no-restricted-imports'],
    why: 'RULE B — Tiffin importing from Origo',
  },
  {
    file: 'tooling/boundary-fixtures/tiffin/violation-planted-hint.tsx',
    expect: ['no-restricted-syntax'],
    why: 'RULE B — data-origo-* attribute and an Origo mention planted in Tiffin',
  },
  {
    file: 'tooling/boundary-fixtures/tiffin/clean.tsx',
    expect: [],
    why: 'RULE B — an ordinary Tiffin component stays clean',
  },
  {
    file: 'tooling/boundary-fixtures/profile/violation-adapter-import.ts',
    expect: ['no-restricted-imports'],
    why: 'RULE C — a portable package reaching past the profile to an adapter',
  },
  {
    file: 'tooling/boundary-fixtures/profile/clean.ts',
    expect: [],
    why: 'RULE C — reading platform facts from PlatformProfile stays clean',
  },
];

const root = path.resolve(import.meta.dirname, '..');
// `ignore: false` so the fixtures — globally ignored by `eslint .` — are linted here.
const eslint = new ESLint({ cwd: root, ignore: false });

let failures = 0;

for (const c of CASES) {
  const [result] = await eslint.lintFiles([path.join(root, c.file)]);
  const fired = [...new Set((result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId))];
  const missing = c.expect.filter((r) => !fired.includes(r));
  const unexpected = c.expect.length === 0 ? fired : [];

  if (missing.length === 0 && unexpected.length === 0) {
    const detail = c.expect.length === 0 ? 'no errors' : fired.join(', ');
    console.log(`  PASS  ${c.file}\n        ${c.why} → ${detail}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${c.file}\n        ${c.why}`);
    if (missing.length > 0) console.log(`        expected rule(s) did not fire: ${missing.join(', ')}`);
    if (unexpected.length > 0) console.log(`        should be clean but reported: ${unexpected.join(', ')}`);
  }
}

console.log(
  failures === 0
    ? `\nboundaries: ${CASES.length}/${CASES.length} ok — RULES A, B and C are enforced.`
    : `\nboundaries: ${failures} of ${CASES.length} case(s) failed. An architectural guardrail is not holding.`,
);

process.exit(failures === 0 ? 0 : 1);
