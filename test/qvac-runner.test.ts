import { describe, expect, it } from 'vitest';

import {
  buildModelConfig,
  QvacRunner,
  resolveModelSource,
  toGenerationParams,
  toSdkResponseFormat,
} from '../src/adapter/qvac-runner.js';
import type {
  QvacSdkModule,
  SdkCompletionOptions,
  SdkLoadOptions,
  SdkTranscribeStats,
  Tracked,
} from '../src/adapter/sdk-api.js';
import { InfraError } from '../src/errors.js';
import type { ResolvedModel } from '../src/suites/load.js';

const llm: ResolvedModel = {
  id: 'tiny-llm',
  kind: 'llm',
  source: 'SMOLLM2_360M_INST_Q8',
  config: {},
  generation: {},
};
const url: ResolvedModel = {
  id: 'remote',
  kind: 'llm',
  source: 'https://example.com/model.gguf',
  config: {},
  generation: {},
};
const asr: ResolvedModel = {
  id: 'tiny-asr',
  kind: 'asr',
  source: 'WHISPER_EN_TINY_Q8_0',
  config: {},
  generation: {},
};
const live = new AbortController().signal;

function tracked<T>(value: Promise<T>, requestId: string): Tracked<T> {
  return Object.assign(value, { requestId });
}

interface Recorder {
  load: SdkLoadOptions[];
  completion: SdkCompletionOptions[];
  embed: { modelId: string; text: string[] }[];
  transcribe: { modelId: string; audioChunk: string }[];
  cancel: string[];
  unload: { modelId: string; clearStorage?: boolean }[];
}

function fakeSdk(overrides: Partial<QvacSdkModule> = {}) {
  const recorder: Recorder = {
    load: [],
    completion: [],
    embed: [],
    transcribe: [],
    cancel: [],
    unload: [],
  };
  const sdk = {
    SMOLLM2_360M_INST_Q8: { name: 'SMOLLM2_360M_INST_Q8', engine: 'llamacpp-completion' },
    WHISPER_EN_TINY_Q8_0: { name: 'WHISPER_EN_TINY_Q8_0', engine: 'whispercpp-transcription' },
    loadModel(options: SdkLoadOptions) {
      recorder.load.push(options);
      return tracked(Promise.resolve('model-1'), 'req-load');
    },
    unloadModel(options: { modelId: string; clearStorage?: boolean }) {
      recorder.unload.push(options);
      return Promise.resolve();
    },
    completion(options: SdkCompletionOptions) {
      recorder.completion.push(options);
      return {
        requestId: 'req-completion',
        events: (async function* () {
          await Promise.resolve();
          yield { type: 'contentDelta' };
          yield { type: 'completionStats' };
        })(),
        final: Promise.resolve({
          contentText: 'Paris',
          stopReason: 'eos',
          stats: {
            timeToFirstToken: 12,
            tokensPerSecond: 250,
            generatedTokens: 3,
            promptTokens: 20,
            backendDevice: 'cpu',
          },
        }),
      };
    },
    embed(options: { modelId: string; text: string[] }) {
      recorder.embed.push(options);
      return tracked(
        Promise.resolve({ embedding: options.text.map(() => [0.6, 0.8]) }),
        'req-embed',
      );
    },
    transcribe(options: { modelId: string; audioChunk: string }) {
      recorder.transcribe.push(options);
      return Object.assign(tracked(Promise.resolve('hello world'), 'req-asr'), {
        stats: Promise.resolve<SdkTranscribeStats>({ audioDuration: 11000, realTimeFactor: 0.01 }),
      });
    },
    cancel(options: { requestId: string }) {
      recorder.cancel.push(options.requestId);
      return Promise.resolve();
    },
    ...overrides,
  } as unknown as QvacSdkModule;
  return { sdk, recorder };
}

function manualClock(): { clock: () => number; set: (value: number) => void } {
  let now = 0;
  return { clock: () => now, set: (value) => (now = value) };
}

describe('configuration mapping', () => {
  it('resolves registry constants and passes URLs and paths through', () => {
    const { sdk } = fakeSdk();
    expect(resolveModelSource(sdk, 'SMOLLM2_360M_INST_Q8')).toEqual({
      name: 'SMOLLM2_360M_INST_Q8',
      engine: 'llamacpp-completion',
    });
    expect(resolveModelSource(sdk, 'https://example.com/m.gguf')).toBe(
      'https://example.com/m.gguf',
    );
    expect(resolveModelSource(sdk, '/models/m.gguf')).toBe('/models/m.gguf');
  });

  it('names a constant that this SDK version does not export', () => {
    const { sdk } = fakeSdk();
    expect(() => resolveModelSource(sdk, 'NEW_MODEL_Q4')).toThrow(InfraError);
    expect(() => resolveModelSource(sdk, 'NEW_MODEL_Q4')).toThrow(
      'does not export the model constant NEW_MODEL_Q4',
    );
  });

  it('forces the device per model kind and lets the model config win', () => {
    expect(buildModelConfig(llm, 'cpu')).toEqual({ device: 'cpu', ctx_size: 2048 });
    expect(buildModelConfig(llm, 'gpu')).toEqual({ device: 'gpu', ctx_size: 2048 });
    expect(buildModelConfig(llm, 'auto')).toEqual({ ctx_size: 2048 });
    expect(buildModelConfig({ ...llm, config: { ctx_size: 512 } }, 'cpu')).toEqual({
      device: 'cpu',
      ctx_size: 512,
    });
    expect(buildModelConfig({ ...llm, kind: 'embedding' }, 'cpu')).toEqual({ device: 'cpu' });
    expect(buildModelConfig(asr, 'cpu')).toEqual({ contextParams: { use_gpu: false } });
    expect(buildModelConfig(asr, 'gpu')).toEqual({ contextParams: { use_gpu: true } });
  });

  it('maps generation settings to the SDK names and skips unset ones', () => {
    expect(
      toGenerationParams({ temperature: 0, seed: 42, maxTokens: 64, reasoningBudget: 0 }),
    ).toEqual({
      temp: 0,
      seed: 42,
      predict: 64,
      reasoning_budget: 0,
    });
    expect(toGenerationParams({ topP: 0.9, topK: 40 })).toEqual({ top_p: 0.9, top_k: 40 });
    expect(toGenerationParams({})).toEqual({});
  });

  it('maps response formats', () => {
    expect(toSdkResponseFormat('json_object')).toEqual({ type: 'json_object' });
    expect(toSdkResponseFormat({ jsonSchema: { type: 'object' } })).toEqual({
      type: 'json_schema',
      json_schema: { name: 'qvac_eval', schema: { type: 'object' } },
    });
  });
});

describe('QvacRunner.load', () => {
  it('loads a registry constant without a model type and reports the load time', async () => {
    const { sdk, recorder } = fakeSdk();
    const time = manualClock();
    const runner = new QvacRunner(sdk, { device: 'cpu', clock: time.clock });
    const pending = runner.load(llm, live);
    time.set(850);
    expect(await pending).toEqual({ loadMs: 850 });
    expect(recorder.load[0]).toMatchObject({
      modelSrc: { name: 'SMOLLM2_360M_INST_Q8' },
      modelConfig: { device: 'cpu', ctx_size: 2048 },
    });
    expect(recorder.load[0]).not.toHaveProperty('modelType');
  });

  it('adds the model type for a URL source', async () => {
    const { sdk, recorder } = fakeSdk();
    await new QvacRunner(sdk, { device: 'cpu' }).load(url, live);
    expect(recorder.load[0]).toMatchObject({
      modelSrc: 'https://example.com/model.gguf',
      modelType: 'llamacpp-completion',
    });
  });

  it('separates the download time from the load time', async () => {
    const time = manualClock();
    const { sdk } = fakeSdk({
      loadModel: (options: SdkLoadOptions) => {
        const done = new Promise<string>((resolve) => {
          setTimeout(() => {
            time.set(1000);
            resolve('model-1');
          }, 0);
        });
        time.set(100);
        options.onProgress?.({ percentage: 10, downloaded: 10, total: 100 });
        time.set(700);
        options.onProgress?.({ percentage: 100, downloaded: 100, total: 100 });
        return tracked(done, 'req-load');
      },
    });
    const stats = await new QvacRunner(sdk, { device: 'cpu', clock: time.clock }).load(llm, live);
    expect(stats).toEqual({ downloadMs: 600, loadMs: 400 });
  });

  it('does not report a download when progress only ever says 100%', async () => {
    const { sdk } = fakeSdk({
      loadModel: (options: SdkLoadOptions) => {
        options.onProgress?.({ percentage: 100, downloaded: 5, total: 5 });
        return tracked(Promise.resolve('model-1'), 'req-load');
      },
    });
    const stats = await new QvacRunner(sdk, { device: 'cpu' }).load(llm, live);
    expect(stats.downloadMs).toBeUndefined();
  });

  it('cancels the load request when the signal aborts', async () => {
    let finish: (id: string) => void = () => undefined;
    const { sdk, recorder } = fakeSdk({
      loadModel: () =>
        tracked(
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
          'req-load',
        ),
    });
    const controller = new AbortController();
    const pending = new QvacRunner(sdk, { device: 'cpu' }).load(llm, controller.signal);
    controller.abort();
    finish('model-1');
    await pending;
    expect(recorder.cancel).toEqual(['req-load']);
  });

  it('turns a worker failure into an infrastructure error and keeps other errors', async () => {
    const crash = Object.assign(new Error('rpc closed'), { name: 'WorkerCrashedError' });
    const { sdk } = fakeSdk({ loadModel: () => tracked(Promise.reject(crash), 'req-load') });
    await expect(new QvacRunner(sdk, { device: 'cpu' }).load(llm, live)).rejects.toThrow(
      InfraError,
    );

    const other = fakeSdk({
      loadModel: () => tracked(Promise.reject(new Error('checksum mismatch')), 'req-load'),
    });
    const failure = new QvacRunner(other.sdk, { device: 'cpu' }).load(llm, live);
    await expect(failure).rejects.toThrow('checksum mismatch');
    await expect(failure).rejects.not.toBeInstanceOf(InfraError);
  });
});

describe('QvacRunner.complete', () => {
  async function loaded(sdk: QvacSdkModule, clock?: () => number) {
    const runner = new QvacRunner(sdk, { device: 'cpu', ...(clock && { clock }) });
    await runner.load(llm, live);
    return runner;
  }

  it('sends the history and generation params and maps the SDK statistics', async () => {
    const { sdk, recorder } = fakeSdk();
    const runner = await loaded(sdk);
    const output = await runner.complete(
      {
        messages: [{ role: 'user', content: 'Capital of France?' }],
        generation: { temperature: 0, seed: 42, maxTokens: 32 },
        responseFormat: 'json_object',
      },
      live,
    );
    expect(recorder.completion[0]).toEqual({
      modelId: 'model-1',
      history: [{ role: 'user', content: 'Capital of France?' }],
      stream: true,
      generationParams: { temp: 0, seed: 42, predict: 32 },
      responseFormat: { type: 'json_object' },
    });
    expect(output).toMatchObject({
      text: 'Paris',
      ttftMs: 12,
      tokensPerSecond: 250,
      generatedTokens: 3,
      promptTokens: 20,
      stopReason: 'eos',
      backend: 'cpu',
    });
  });

  it('falls back to the first streamed token when the SDK reports no time to first token', async () => {
    const time = manualClock();
    const { sdk } = fakeSdk({
      completion: () => ({
        requestId: 'req-completion',
        events: (async function* () {
          time.set(40);
          yield { type: 'contentDelta' };
          time.set(90);
          await Promise.resolve();
        })(),
        final: Promise.resolve({ contentText: 'Paris' }),
      }),
    });
    const runner = await loaded(sdk, time.clock);
    time.set(10);
    const output = await runner.complete(
      { messages: [{ role: 'user', content: 'Hi' }], generation: {} },
      live,
    );
    expect(output.ttftMs).toBe(30);
    expect(output.wallMs).toBe(80);
    expect(output.tokensPerSecond).toBeUndefined();
  });

  it('cancels the request by id when the signal aborts, even if it was aborted already', async () => {
    const { sdk, recorder } = fakeSdk();
    const runner = await loaded(sdk);
    const controller = new AbortController();
    controller.abort();
    await runner.complete(
      { messages: [{ role: 'user', content: 'Hi' }], generation: {} },
      controller.signal,
    );
    expect(recorder.cancel).toEqual(['req-completion']);
  });

  it('removes its abort listener when the request ends', async () => {
    const { sdk, recorder } = fakeSdk();
    const runner = await loaded(sdk);
    const controller = new AbortController();
    await runner.complete(
      { messages: [{ role: 'user', content: 'Hi' }], generation: {} },
      controller.signal,
    );
    controller.abort();
    expect(recorder.cancel).toEqual([]);
  });

  it('rejects with the SDK error and never swallows a cancelled run', async () => {
    const cancelled = Object.assign(new Error('was cancelled'), {
      name: 'InferenceCancelledError',
    });
    const { sdk } = fakeSdk({
      completion: () => ({
        requestId: 'req-completion',
        events: (async function* () {
          await Promise.resolve();
          yield { type: 'completionDone' };
        })(),
        final: Promise.reject(cancelled),
      }),
    });
    const runner = await loaded(sdk);
    await expect(
      runner.complete({ messages: [{ role: 'user', content: 'Hi' }], generation: {} }, live),
    ).rejects.toBe(cancelled);
  });

  it('refuses to run before a model is loaded', async () => {
    const runner = new QvacRunner(fakeSdk().sdk, { device: 'cpu' });
    await expect(runner.complete({ messages: [], generation: {} }, live)).rejects.toThrow(
      'No model is loaded',
    );
  });
});

describe('QvacRunner.embed and transcribe', () => {
  it('returns one vector per text and wraps a single vector', async () => {
    const { sdk, recorder } = fakeSdk();
    const runner = new QvacRunner(sdk, { device: 'cpu' });
    await runner.load({ ...llm, kind: 'embedding' }, live);
    const batch = await runner.embed(['a', 'b'], live);
    expect(batch.vectors).toEqual([
      [0.6, 0.8],
      [0.6, 0.8],
    ]);
    expect(recorder.embed[0]).toEqual({ modelId: 'model-1', text: ['a', 'b'] });

    const single = fakeSdk({
      embed: () => tracked(Promise.resolve({ embedding: [0.1, 0.2] }), 'req-embed'),
    });
    const second = new QvacRunner(single.sdk, { device: 'cpu' });
    await second.load({ ...llm, kind: 'embedding' }, live);
    expect((await second.embed(['a'], live)).vectors).toEqual([[0.1, 0.2]]);
  });

  it('reads the audio duration and real-time factor from the transcription stats', async () => {
    const { sdk, recorder } = fakeSdk();
    const runner = new QvacRunner(sdk, { device: 'cpu' });
    await runner.load(asr, live);
    const output = await runner.transcribe('/audio/a.wav', live);
    expect(recorder.transcribe[0]).toEqual({ modelId: 'model-1', audioChunk: '/audio/a.wav' });
    expect(output).toMatchObject({ text: 'hello world', audioMs: 11000, realTimeFactor: 0.01 });
  });

  it('works when the SDK exposes no stats or rejects them', async () => {
    const variants = [
      () => ({}),
      () => ({ stats: Promise.reject<SdkTranscribeStats>(new Error('no stats')) }),
    ];
    for (const extra of variants) {
      const { sdk } = fakeSdk({
        transcribe: () => Object.assign(tracked(Promise.resolve('hi'), 'req-asr'), extra()),
      });
      const runner = new QvacRunner(sdk, { device: 'cpu' });
      await runner.load(asr, live);
      const output = await runner.transcribe('/a.wav', live);
      expect(output.text).toBe('hi');
      expect(output.audioMs).toBeUndefined();
    }
  });
});

describe('QvacRunner.unload', () => {
  it('unloads once, keeps the weights on disk and is safe to call again', async () => {
    const { sdk, recorder } = fakeSdk();
    const runner = new QvacRunner(sdk, { device: 'cpu' });
    await runner.unload();
    expect(recorder.unload).toEqual([]);
    await runner.load(llm, live);
    await runner.unload();
    await runner.unload();
    expect(recorder.unload).toEqual([{ modelId: 'model-1', clearStorage: false }]);
  });

  it('wraps an unload failure with its cause', async () => {
    const { sdk } = fakeSdk({ unloadModel: () => Promise.reject(new Error('worker gone')) });
    const runner = new QvacRunner(sdk, { device: 'cpu' });
    await runner.load(llm, live);
    await expect(runner.unload()).rejects.toThrow('unloadModel failed: worker gone');
  });
});
