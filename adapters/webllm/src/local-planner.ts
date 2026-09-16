/**
 * LocalPlanner — a small instruct model running in this browser, on WebGPU.
 *
 * This is the tier that makes the headline claim literally true rather than
 * merely promised: once the weights are cached, the whole loop runs with the
 * network switched off, and the status strip shows it.
 *
 * It lives in an adapter rather than in packages/planner because WebLLM needs
 * `navigator.gpu` and packages/** is machine-forbidden from containing web code
 * (RULE A, DECISIONS D9). On Android, MediaPipe gets its own adapter behind this
 * same interface and nothing above it changes.
 *
 * ACCURACY: the backend readout is whatever the runtime reports. WebLLM runs on
 * WebGPU; on Android MediaPipe runs on GPU or CPU. We never say NPU.
 */

import type { Result } from '@origo/core';
import { describeThrown, err, estimateTokens, ok } from '@origo/core';
import type { Planner, PlanError, PlanOutput, PlanRequest, PlannerInfo } from '@origo/planner';
import { DECODING, assemblePrompt } from '@origo/planner';
// TYPE-ONLY import: erased at build time, so the 2MB WebLLM runtime is NOT in
// the initial bundle. It is fetched by a dynamic import the first time someone
// actually loads the model — which matters on conference wifi, where a judge
// who only wants to watch a scripted run should not pay for a runtime they will
// never execute.
import type * as WebLLM from '@mlc-ai/web-llm';

/**
 * The model.
 *
 * Qwen2.5 1.5B Instruct, q4f16_1 — chosen by MEASUREMENT, not by reputation.
 *
 * Llama 3.2 1B was the first choice because 1B is exactly the class we will run
 * on the phone. It failed on the thing that matters: across 20 calls against
 * real screens it emitted node index 0 on 18 of them, reading the goal and
 * writing a plausible action without ever attending to the element list. Three
 * measured prompt fixes took it from 87% to 75% invalid and no further.
 *
 * Qwen2.5-1.5B is still in the 1B-2B class, so the phone story survives, and it
 * is markedly stronger at structured output. See docs/DECISIONS.md D12 for the
 * side-by-side table.
 *
 * Held as constants because these are the one line to edit when we change them.
 */
export const DEFAULT_LOCAL_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

/** The original 1B. Kept selectable so the comparison stays reproducible. */
export const SMALLER_LOCAL_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export interface LoadProgress {
  /** 0..1. Real progress from the runtime, never a fake animation. */
  readonly progress: number;
  readonly text: string;
}

export interface LocalPlannerOptions {
  readonly model?: string;
  readonly onProgress?: (progress: LoadProgress) => void;
}

/** WebGPU detection. Cheap, safe to call repeatedly, and never throws. */
export async function detectWebGpu(): Promise<{ available: boolean; reason: string }> {
  const gpu = (globalThis.navigator as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
  if (!gpu) {
    return {
      available: false,
      reason:
        'This browser has no WebGPU. Chrome or Edge 113+ on a machine with a supported GPU can run the on-device tier.',
    };
  }
  try {
    const adapter = await gpu.requestAdapter();
    return adapter
      ? { available: true, reason: 'WebGPU adapter available.' }
      : { available: false, reason: 'WebGPU is present but no adapter was granted, so no GPU is usable here.' };
  } catch (cause) {
    return { available: false, reason: `WebGPU probe failed: ${describeThrown(cause)}` };
  }
}

export class LocalPlanner implements Planner {
  readonly info: PlannerInfo;
  private engine: WebLLM.MLCEngineInterface | null = null;
  private loading: Promise<Result<WebLLM.MLCEngineInterface, PlanError>> | null = null;
  private readonly options: LocalPlannerOptions;

  constructor(options: LocalPlannerOptions = {}) {
    this.options = options;
    this.info = {
      tier: 'local',
      model: options.model ?? DEFAULT_LOCAL_MODEL,
      detail: 'Runs in this browser on WebGPU. Nothing leaves the device; works with the network off once cached.',
      onDevice: true,
    };
  }

  get loaded(): boolean {
    return this.engine !== null;
  }

  async available(): Promise<boolean> {
    return (await detectWebGpu()).available;
  }

  /**
   * Loads the weights. Safe to call repeatedly: concurrent callers share one
   * load, and a failed load can be retried rather than poisoning the planner.
   */
  async preload(): Promise<Result<true, PlanError>> {
    const engine = await this.ensureEngine();
    return engine.ok ? ok(true) : err(engine.error);
  }

  private ensureEngine(): Promise<Result<WebLLM.MLCEngineInterface, PlanError>> {
    if (this.engine) return Promise.resolve(ok(this.engine));
    if (this.loading) return this.loading;

    this.loading = (async (): Promise<Result<WebLLM.MLCEngineInterface, PlanError>> => {
      const probe = await detectWebGpu();
      if (!probe.available) {
        this.loading = null;
        return err({ kind: 'unavailable', message: probe.reason, retryable: false });
      }
      try {
        const webllm = await import('@mlc-ai/web-llm');
        const engine = await webllm.CreateMLCEngine(this.info.model, {
          initProgressCallback: (report) => {
            this.options.onProgress?.({ progress: report.progress, text: report.text });
          },
        });
        this.engine = engine;
        return ok(engine);
      } catch (cause) {
        // A failed load must not poison the planner: clearing `loading` lets a
        // retry actually retry, which matters on conference wifi.
        this.loading = null;
        return err({
          kind: 'unavailable',
          message: `The on-device model could not load: ${describeThrown(cause)}`,
          retryable: true,
        });
      }
    })();

    return this.loading;
  }

  async next(request: PlanRequest, signal: AbortSignal): Promise<Result<PlanOutput, PlanError>> {
    const engineResult = await this.ensureEngine();
    if (!engineResult.ok) return err(engineResult.error);
    if (signal.aborted) return err({ kind: 'aborted', message: 'Cancelled during planning.', retryable: false });

    const started = Date.now();
    const prompt = assemblePrompt(request, estimateTokens);

    try {
      // Streaming, so STOP can abort mid-generation rather than waiting for the
      // model to finish a sentence it is no longer allowed to act on.
      const stream = await engineResult.value.chat.completions.create({
        stream: true,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: DECODING.temperature,
        top_p: DECODING.topP,
        max_tokens: DECODING.maxTokens,
        stop: [...DECODING.stop],
      });

      // DRAIN THE STREAM, NEVER BREAK OUT OF IT.
      //
      // The first version broke out of this loop as soon as the JSON object
      // closed, then called interruptGenerate(). That wedged the engine: the
      // first call returned, and every call after it hung forever. The Gate 2
      // harness spent fifteen minutes on one planning call before this was
      // spotted, which is exactly the failure a demo cannot survive.
      //
      // The correct shape is to ASK for the interrupt and keep consuming until
      // the iterator ends on its own, so WebLLM can finish its own cleanup.
      let raw = '';
      let interrupted = false;
      let cancelled = false;
      for await (const chunk of stream) {
        raw += chunk.choices[0]?.delta.content ?? '';
        if (signal.aborted) {
          cancelled = true;
          if (!interrupted) {
            interrupted = true;
            await engineResult.value.interruptGenerate();
          }
          continue;
        }
        // A small model that has closed its object has said everything useful;
        // anything after it is the prose we told it not to write.
        if (!interrupted && raw.includes('}')) {
          interrupted = true;
          await engineResult.value.interruptGenerate();
        }
      }
      if (cancelled) return err({ kind: 'aborted', message: 'Cancelled during planning.', retryable: false });

      if (raw.trim() === '') {
        return err({ kind: 'empty', message: 'The on-device model returned nothing.', retryable: true });
      }
      return ok({ raw, latencyMs: Date.now() - started, promptTokens: prompt.estimatedTokens });
    } catch (cause) {
      if (signal.aborted) return err({ kind: 'aborted', message: 'Cancelled during planning.', retryable: false });
      return err({
        kind: 'provider-error',
        message: `On-device inference failed: ${describeThrown(cause)}`,
        retryable: true,
      });
    }
  }

  /**
   * One raw completion with a caller-supplied prompt.
   *
   * Diagnostics only, and deliberately not part of the Planner interface: it
   * exists so the Gate 2 harness can separate prefill cost from decode cost by
   * varying the prompt length. That distinction decides whether a slow result
   * means "the model is too big" or "the prompt is too long".
   */
  async rawComplete(system: string, user: string): Promise<string> {
    const engineResult = await this.ensureEngine();
    if (!engineResult.ok) return `ERROR: ${engineResult.error.message}`;
    const reply = await engineResult.value.chat.completions.create({
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: DECODING.temperature,
      max_tokens: DECODING.maxTokens,
      stop: [...DECODING.stop],
    });
    return reply.choices[0]?.message.content ?? '';
  }

  /** Frees GPU memory. Called when switching tiers. */
  async unload(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    this.loading = null;
    try {
      await engine?.unload();
    } catch {
      // Unload failing is not worth failing a run over; the page is about to
      // move on either way.
    }
  }
}
