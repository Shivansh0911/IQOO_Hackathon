# Attribution

Generated from the real dependency tree (`pnpm ls -r --depth 0`), not from
memory. Everything here is free and open source; nothing in this project
requires a paid licence, a paid API or a paid host.

## Shipped in the product

| package | version | licence | what it does for us |
|---|---|---|---|
| [react](https://react.dev) | 18.3.1 | MIT | UI for Tiffin, the console and the extension panel |
| react-dom | 18.3.1 | MIT | DOM renderer |
| [zustand](https://github.com/pmndrs/zustand) | 4.5.7 | MIT | Tiffin's app state and the console's RunEvent reducer |
| [zod](https://zod.dev) | 3.25.76 | MIT | The action schemas. Every model output passes through these |
| [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) | 0.2.85 | Apache-2.0 | The on-device tier: a 1B model in the browser on WebGPU |

## Build and test only

| package | version | licence | what it does for us |
|---|---|---|---|
| [typescript](https://www.typescriptlang.org) | 5.9.3 | Apache-2.0 | Strict types; the `lib` setting is how core is kept DOM-free |
| [vite](https://vite.dev) | 5.4.21 | MIT | Dev server and static builds |
| @vitejs/plugin-react | 4.7.0 | MIT | React fast refresh and JSX |
| [esbuild](https://esbuild.github.io) | 0.28.2 | MIT | Bundles the extension's content script and service worker |
| [vitest](https://vitest.dev) | 2.1.9 | MIT | 290 tests |
| [jsdom](https://github.com/jsdom/jsdom) | 25.0.1 | MIT | A DOM for the reader's flag tests (pinned to 25: 27 breaks on Node 20) |
| [playwright](https://playwright.dev) | 1.63.0 | Apache-2.0 | Real-browser measurement — pruning, tokens, end-to-end runs, Gate 2 |
| [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) | 4.0.0 | MIT | Real BPE token counts, so the deck quotes a measurement |
| [eslint](https://eslint.org) | 9.39.5 | MIT | Enforces RULES A, B and C — the architectural boundaries |
| @eslint/js | 9.39.5 | MIT | ESLint's recommended rules |
| [typescript-eslint](https://typescript-eslint.io) | 8.70.0 | MIT | TypeScript support for ESLint |
| @types/node, @types/react, @types/react-dom, @types/chrome | — | MIT | Type definitions |

## Models

| model | licence | where |
|---|---|---|
| Llama 3.2 1B Instruct (q4f16_1, MLC build) | [Llama 3.2 Community Licence](https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/LICENSE) | The default on-device tier. Weights fetched from the MLC CDN and cached in the browser |
| Whatever free-tier model OpenRouter serves | per-model | The cloud tier. The model id is configurable and is displayed in the status strip |
| Gemma 3 1B (planned, Android) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) | The on-device tier on the phone, via MediaPipe LLM Inference |

## Services

| service | cost | why |
|---|---|---|
| [OpenRouter](https://openrouter.ai) | free tier | The cloud planner. The key is supplied at runtime and never committed |
| MLC model CDN | free | Serves the WebLLM weights on first load |

## Not used

Stated because it is easy to assume otherwise: no vision model, no OCR, no
search API, no text-to-speech, no avatar service, no analytics, no error
reporting service, no backend of any kind. The agent reads the screen it is
given; it does not browse the internet.

## Our own work

Everything in `packages/`, `adapters/`, `apps/`, `tooling/`, `scripts/` and
`docs/` was written for this project by Tushya Jain and Shivansh Shekher Ojha,
with the commit history as the record.

Tiffin's brands, menus and copy are invented. No real company's name, mark,
logo, colours or trade dress is reproduced anywhere in this repository.
