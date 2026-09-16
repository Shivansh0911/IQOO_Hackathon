/**
 * CloudPlanner — OpenRouter, free tier only.
 *
 * For machines with no WebGPU, for fast iteration while developing, and it is
 * the same route the hackathon's own OpenRouter credits will take on site, so
 * building it now means that path is already wired.
 *
 * NO KEY IS EVER COMMITTED. The key arrives at runtime — from an env var in
 * development, or from a field the user fills in the deployed app. With no key
 * this planner simply reports itself unavailable and the registry falls through
 * to another tier. A stranger opening our link must never meet a key prompt.
 *
 * `fetch` is injected rather than reached for, which keeps this file
 * platform-agnostic (RULE A) and lets tests drive it without a network.
 */

import type { Result } from '@origo/core';
import { attemptAsync, describeThrown, err, estimateTokens, ok } from '@origo/core';
import type { Planner, PlanError, PlanOutput, PlanRequest, PlannerInfo } from './planner.js';
import { DECODING } from './planner.js';
import { assemblePrompt } from './prompt.js';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Free-tier default. Held as a constant rather than inlined because free-tier
 * availability changes without notice and this is the one line to edit.
 */
export const DEFAULT_CLOUD_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface CloudPlannerOptions {
  /** Read from an env var or a UI field. Absent is a supported, non-fatal state. */
  readonly apiKey: () => string | null;
  readonly model?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** Sent as HTTP-Referer, which OpenRouter uses for free-tier attribution. */
  readonly referer?: string;
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export class CloudPlanner implements Planner {
  readonly info: PlannerInfo;
  private readonly options: CloudPlannerOptions;

  constructor(options: CloudPlannerOptions) {
    this.options = options;
    const model = options.model ?? DEFAULT_CLOUD_MODEL;
    this.info = {
      tier: 'cloud',
      model,
      detail: 'OpenRouter free tier. The screen JSON leaves this device.',
      // Stated plainly and never softened: this tier is not on-device.
      onDevice: false,
    };
  }

  available(): Promise<boolean> {
    return Promise.resolve(this.options.apiKey() !== null && this.options.apiKey() !== '');
  }

  async next(request: PlanRequest, signal: AbortSignal): Promise<Result<PlanOutput, PlanError>> {
    const key = this.options.apiKey();
    if (!key) {
      return err({
        kind: 'not-configured',
        message: 'No OpenRouter key. Add one in the console, or use the on-device or mock tier.',
        retryable: false,
      });
    }

    const started = Date.now();
    const prompt = assemblePrompt(request, estimateTokens);
    const doFetch = this.options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!doFetch) {
      return err({ kind: 'unavailable', message: 'This runtime has no fetch implementation.', retryable: false });
    }

    // Our own timeout, combined with the caller's STOP signal, so a hung
    // request can never leave the console spinning forever.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs ?? 20_000);
    const onAbort = (): void => timeout.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await attemptAsync(
        () =>
          doFetch(OPENROUTER_URL, {
            method: 'POST',
            signal: timeout.signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${key}`,
              'HTTP-Referer': this.options.referer ?? 'https://github.com/Shivansh0911/IQOO_Hackathon',
              'X-Title': 'Origo Loop',
            },
            body: JSON.stringify({
              model: this.info.model,
              temperature: DECODING.temperature,
              top_p: DECODING.topP,
              max_tokens: DECODING.maxTokens,
              stop: [...DECODING.stop],
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
              ],
            }),
          }),
        (cause) => describeThrown(cause),
      );

      if (!response.ok) {
        if (signal.aborted) return err({ kind: 'aborted', message: 'Cancelled during planning.', retryable: false });
        if (timeout.signal.aborted) {
          return err({ kind: 'timeout', message: 'OpenRouter did not answer in time.', retryable: true });
        }
        return err({ kind: 'network', message: `Could not reach OpenRouter: ${response.error}`, retryable: true });
      }

      const http = response.value;
      if (!http.ok) {
        const body = await http.text().catch(() => '');
        return err({
          kind: http.status === 429 ? 'network' : 'provider-error',
          message:
            http.status === 429
              ? 'OpenRouter free tier is rate-limited right now. Try the on-device tier.'
              : `OpenRouter returned ${http.status}. ${body.slice(0, 200)}`,
          retryable: http.status === 429 || http.status >= 500,
        });
      }

      const parsed = await attemptAsync(
        () => http.json() as Promise<ChatCompletion>,
        (cause) => describeThrown(cause),
      );
      if (!parsed.ok) {
        return err({ kind: 'provider-error', message: `OpenRouter sent unreadable JSON: ${parsed.error}`, retryable: true });
      }
      if (parsed.value.error?.message) {
        return err({ kind: 'provider-error', message: parsed.value.error.message, retryable: false });
      }

      const content = parsed.value.choices?.[0]?.message?.content;
      if (!content || content.trim() === '') {
        return err({ kind: 'empty', message: 'The model returned an empty reply.', retryable: true });
      }

      return ok({ raw: content, latencyMs: Date.now() - started, promptTokens: prompt.estimatedTokens });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
