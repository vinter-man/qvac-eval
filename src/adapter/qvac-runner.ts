import { describeError, InfraError } from '../errors.js';
import type { ResolvedModel } from '../suites/load.js';
import type { Generation, ModelKind, ResponseFormat } from '../suites/schema.js';
import type { QvacSdkModule, SdkProgress } from './sdk-api.js';
import type {
  CompletionOutput,
  CompletionRequest,
  Device,
  EmbedOutput,
  LoadStats,
  ModelRunner,
  TranscribeOutput,
} from './types.js';

const MODEL_TYPE: Record<ModelKind, string> = {
  llm: 'llamacpp-completion',
  embedding: 'llamacpp-embedding',
  asr: 'whispercpp-transcription',
};

const CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

const WORKER_FAILURES = new Set([
  'WorkerCrashedError',
  'WorkerShutdownError',
  'WorkerStartupError',
  'BareRuntimeBinaryNotFoundError',
]);

export type Clock = () => number;

export interface QvacRunnerOptions {
  device: Device;
  clock?: Clock;
}

export function resolveModelSource(sdk: QvacSdkModule, source: string): unknown {
  if (!CONSTANT_PATTERN.test(source)) return source;
  const constant = sdk[source];
  if (constant === undefined) {
    throw new InfraError(`@qvac/sdk does not export the model constant ${source}`);
  }
  return constant;
}

function deviceConfig(kind: ModelKind, device: Device): Record<string, unknown> {
  if (device === 'auto') return {};
  if (kind === 'asr') return { contextParams: { use_gpu: device === 'gpu' } };
  return { device };
}

export function buildModelConfig(model: ResolvedModel, device: Device): Record<string, unknown> {
  const defaults = model.kind === 'llm' ? { ctx_size: 2048 } : {};
  return { ...deviceConfig(model.kind, device), ...defaults, ...model.config };
}

export function toGenerationParams(generation: Generation): Record<string, number> {
  const params: Record<string, number> = {};
  const mapping = [
    ['temp', generation.temperature],
    ['seed', generation.seed],
    ['predict', generation.maxTokens],
    ['top_p', generation.topP],
    ['top_k', generation.topK],
    ['reasoning_budget', generation.reasoningBudget],
  ] as const;
  for (const [name, value] of mapping) {
    if (value !== undefined) params[name] = value;
  }
  return params;
}

export function toSdkResponseFormat(format: ResponseFormat): Record<string, unknown> {
  if (format === 'json_object') return { type: 'json_object' };
  return { type: 'json_schema', json_schema: { name: 'qvac_eval', schema: format.jsonSchema } };
}

function translateError(error: unknown): unknown {
  if (error instanceof Error && WORKER_FAILURES.has(error.name)) {
    return new InfraError(`The QVAC worker failed: ${error.message}`, { cause: error });
  }
  return error;
}

export class QvacRunner implements ModelRunner {
  private modelId: string | undefined;
  private readonly clock: Clock;

  constructor(
    private readonly sdk: QvacSdkModule,
    private readonly options: QvacRunnerOptions,
  ) {
    this.clock = options.clock ?? (() => performance.now());
  }

  private loaded(): string {
    if (this.modelId === undefined) throw new Error('No model is loaded');
    return this.modelId;
  }

  private cancelOnAbort(signal: AbortSignal, requestId: string): () => void {
    const cancel = () => {
      this.sdk.cancel({ requestId }).catch(() => undefined);
    };
    if (signal.aborted) cancel();
    signal.addEventListener('abort', cancel, { once: true });
    return () => {
      signal.removeEventListener('abort', cancel);
    };
  }

  async load(model: ResolvedModel, signal: AbortSignal): Promise<LoadStats> {
    const source = resolveModelSource(this.sdk, model.source);
    const isConstant = CONSTANT_PATTERN.test(model.source);
    const download: { first?: number; last?: number; partial: boolean } = { partial: false };

    const started = this.clock();
    const pending = this.sdk.loadModel({
      modelSrc: source,
      ...(!isConstant && { modelType: MODEL_TYPE[model.kind] }),
      modelConfig: buildModelConfig(model, this.options.device),
      onProgress: (progress: SdkProgress) => {
        const now = this.clock();
        download.first ??= now;
        download.last = now;
        if (progress.percentage < 100) download.partial = true;
      },
    });
    const stop = this.cancelOnAbort(signal, pending.requestId);
    try {
      this.modelId = await pending;
    } catch (error) {
      throw translateError(error);
    } finally {
      stop();
    }

    const total = this.clock() - started;
    const downloadMs =
      download.partial && download.first !== undefined && download.last !== undefined
        ? download.last - download.first
        : undefined;
    return {
      loadMs: Math.max(0, total - (downloadMs ?? 0)),
      ...(downloadMs !== undefined && { downloadMs }),
    };
  }

  async complete(request: CompletionRequest, signal: AbortSignal): Promise<CompletionOutput> {
    const started = this.clock();
    const run = this.sdk.completion({
      modelId: this.loaded(),
      history: request.messages,
      stream: true,
      generationParams: toGenerationParams(request.generation),
      ...(request.responseFormat !== undefined && {
        responseFormat: toSdkResponseFormat(request.responseFormat),
      }),
    });
    run.final.catch(() => undefined);
    const stop = this.cancelOnAbort(signal, run.requestId);
    try {
      let firstTokenAt: number | undefined;
      for await (const event of run.events) {
        if (event.type === 'contentDelta') firstTokenAt ??= this.clock();
      }
      const final = await run.final;
      const wallMs = this.clock() - started;
      const stats = final.stats;
      const ttftMs =
        stats?.timeToFirstToken ??
        (firstTokenAt === undefined ? undefined : firstTokenAt - started);
      return {
        text: final.contentText,
        wallMs,
        ...(ttftMs !== undefined && { ttftMs }),
        ...(stats?.tokensPerSecond !== undefined && { tokensPerSecond: stats.tokensPerSecond }),
        ...(stats?.generatedTokens !== undefined && { generatedTokens: stats.generatedTokens }),
        ...(final.stopReason !== undefined && { stopReason: final.stopReason }),
        ...(stats?.backendDevice !== undefined && { backend: stats.backendDevice }),
      };
    } catch (error) {
      throw translateError(error);
    } finally {
      stop();
    }
  }

  async embed(texts: readonly string[], signal: AbortSignal): Promise<EmbedOutput> {
    const started = this.clock();
    const pending = this.sdk.embed({ modelId: this.loaded(), text: [...texts] });
    const stop = this.cancelOnAbort(signal, pending.requestId);
    try {
      const { embedding } = await pending;
      const wallMs = this.clock() - started;
      const first = embedding[0];
      const vectors = Array.isArray(first) ? (embedding as number[][]) : [embedding as number[]];
      return { vectors, wallMs };
    } catch (error) {
      throw translateError(error);
    } finally {
      stop();
    }
  }

  async transcribe(audioPath: string, signal: AbortSignal): Promise<TranscribeOutput> {
    const started = this.clock();
    const pending = this.sdk.transcribe({ modelId: this.loaded(), audioChunk: audioPath });
    const stop = this.cancelOnAbort(signal, pending.requestId);
    try {
      const text = await pending;
      const wallMs = this.clock() - started;
      const stats = await Promise.resolve(pending.stats).catch(() => undefined);
      return {
        text,
        wallMs,
        ...(stats?.audioDuration !== undefined && { audioMs: stats.audioDuration }),
        ...(stats?.realTimeFactor !== undefined && { realTimeFactor: stats.realTimeFactor }),
      };
    } catch (error) {
      throw translateError(error);
    } finally {
      stop();
    }
  }

  async unload(): Promise<void> {
    const modelId = this.modelId;
    if (modelId === undefined) return;
    this.modelId = undefined;
    try {
      await this.sdk.unloadModel({ modelId, clearStorage: false });
    } catch (error) {
      throw new Error(`unloadModel failed: ${describeError(error)}`, { cause: error });
    }
  }
}
