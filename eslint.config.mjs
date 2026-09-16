// Origo Loop — lint configuration.
//
// Two architectural rules matter more than every style rule combined, so they
// live here and they fail the build (brief §1, §2):
//
//   RULE A — the portable zone (packages/**) contains zero web-specific code.
//            That zone is what ports to Android unchanged; if React or `document`
//            leaks into it, the port stops being a swap and becomes a rewrite.
//
//   RULE B — apps/tiffin knows nothing about Origo. No imports from the agent,
//            no planted test ids, no data-origo-* attributes. The agent has to
//            find its way by reading the DOM, exactly as it will read the
//            accessibility tree on Android.
//
// Both rules are also exercised against deliberately-violating fixtures in
// tooling/boundary-fixtures, checked by `pnpm boundaries`, so the guardrail
// itself is regression-tested rather than merely present.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Zone globs. Fixture dirs are policed by the same rules as the real zone. */
export const ZONES = {
  portable: ['packages/**/*.{ts,tsx}', 'tooling/boundary-fixtures/core/**/*.{ts,tsx}'],
  tiffin: ['apps/tiffin/**/*.{ts,tsx}', 'tooling/boundary-fixtures/tiffin/**/*.{ts,tsx}'],
  /**
   * RULE C applies to everything that is NOT allowed to name an adapter.
   * The allowed list is small and explicit: the adapters themselves, the two
   * apps that compose a profile at startup, and the dev tooling.
   */
  profileConsumers: [
    'packages/**/*.{ts,tsx}',
    'tooling/boundary-fixtures/profile/**/*.{ts,tsx}',
  ],
};

/** Browser/DOM globals that must never appear in the portable zone. */
const WEB_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'alert',
  'confirm',
  'prompt',
  'getComputedStyle',
  'requestAnimationFrame',
  'MutationObserver',
  'HTMLElement',
  'Element',
  'CSSStyleDeclaration',
  'XMLHttpRequest',
];

/** Import specifiers that make code web-only. */
const WEB_IMPORT_PATTERNS = [
  { group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: 'RULE A: packages/** must not import React. UI belongs in apps/**; the portable zone ports to Android unchanged.' },
  { group: ['zustand', 'zustand/*'], message: 'RULE A: packages/** must not import a browser state library. Keep state in the app layer.' },
  { group: ['*.css', '*.scss', '*.svg', '*.png'], message: 'RULE A: packages/** must not import assets or styles.' },
  { group: ['@origo/adapter-web', '@origo/adapter-web/*'], message: 'RULE A: packages/** must not import the web adapter. Depend on the ports in @origo/core, never on an implementation.' },
  { group: ['**/adapters/web/**', '**/apps/**'], message: 'RULE A: packages/** must not reach into adapters/web or apps/**. That inverts the platform boundary.' },
];

export default tseslint.config(
  {
    // Fixtures are deliberately-violating code. `eslint .` skips them; the
    // boundaries check lints them explicitly with `ignore: false`.
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.vite/**', 'tooling/boundary-fixtures/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Base language options for every source file in the repo.
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // No TODO without a tag and a reason (brief §14).
      'no-warning-comments': ['error', { terms: ['todo:', 'fixme'], location: 'start' }],
    },
  },

  {
    // ─── RULE A ─────────────────────────────────────────────────────────────
    name: 'origo/portable-zone-has-no-web',
    files: ZONES.portable,
    rules: {
      'no-restricted-imports': ['error', { patterns: WEB_IMPORT_PATTERNS }],
      'no-restricted-globals': [
        'error',
        ...WEB_GLOBALS.map((name) => ({
          name,
          message: `RULE A: \`${name}\` is a web global. packages/** is platform-agnostic and must reach the UI only through the ports in @origo/core.`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeReference > TSQualifiedName[left.name="globalThis"]',
          message: 'RULE A: no globalThis type references in the portable zone.',
        },
      ],
    },
  },

  {
    // ─── RULE B ─────────────────────────────────────────────────────────────
    name: 'origo/tiffin-knows-nothing-about-origo',
    files: ZONES.tiffin,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@origo/*', '**/packages/**', '**/adapters/**'],
              message: 'RULE B: apps/tiffin must not import anything from Origo. The target app knows nothing about the agent — if it did, the demo would be a lie.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name=/^data-origo/]',
          message: 'RULE B: no data-origo-* attributes in Tiffin. The agent finds elements by reading the DOM, not by hints planted for it.',
        },
        {
          selector: 'JSXAttribute[name.name=/^data-agent/]',
          message: 'RULE B: no data-agent-* attributes in Tiffin. Same reason as data-origo-*.',
        },
        {
          selector: 'Literal[value=/^origo/i]',
          message: 'RULE B: Tiffin must not name Origo, not even in a string. It is a separate product by a separate team.',
        },
      ],
    },
  },

  {
    // ─── RULE C ─────────────────────────────────────────────────────────────
    //
    // Reach the platform through PlatformProfile, never through an adapter.
    // With three platforms the seam has to be machine-enforced: the difference
    // between having an abstraction and having a habit is whether the build
    // fails when someone reaches past it.
    //
    // apps/demo, apps/extension and adapters/** are exempt — something has to
    // construct the profile, and that is their job.
    name: 'origo/reach-the-platform-through-the-profile',
    files: ZONES.profileConsumers,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...WEB_IMPORT_PATTERNS,
            {
              group: ['@origo/adapter-*', '**/adapters/*/**'],
              message:
                'RULE C: import PlatformProfile from @origo/core, not an adapter. Only apps/demo, apps/extension and adapters/** may name an adapter directly — everything else reads its platform facts from the profile.',
            },
          ],
        },
      ],
    },
  },

  {
    // Tooling and config files run in Node and are exempt from RULE A.
    files: ['scripts/**/*.{mjs,ts}', '*.config.{mjs,ts}', 'eslint.config.mjs'],
    languageOptions: {
      // `document` is here because Playwright's page.evaluate callbacks are
      // serialised and run INSIDE the browser, not in Node. They are browser
      // code that happens to live in a Node file.
      globals: {
        console: 'readonly',
        process: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        // document/navigator/URL run INSIDE page.evaluate, not in Node.
        document: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },

  {
    // Fixtures exist to be linted, not to be shipped.
    files: ['tooling/boundary-fixtures/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
);
