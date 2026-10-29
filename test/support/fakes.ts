import type {
  CompletionOutput,
  CompletionRequest,
  EmbedOutput,
  LoadStats,
  ModelRunner,
  RunnerSession,
  TranscribeOutput,
} from '../../src/adapter/types.js';
import type { MemorySampler } from '../../src/run/memory.js';
import type { ResolvedModel } from '../../src/suites/load.js';

export interface FakeBehavior {
  load?: (signal: AbortSignal) => Promise<LoadStats> | LoadStats;
  complete?: (
    request: CompletionRequest,
    signal: AbortSignal,
    call: number,
  ) => Promise<CompletionOutput> | CompletionOutput;
  embed?: (
    texts: readonly string[],
    signal: AbortSignal,
    call: number,
  ) => Promise<EmbedOutput> | EmbedOutput;
  transcribe?: (
    path: string,
    signal: AbortSignal,
    call: number,
  ) => Promise<TranscribeOutput> | TranscribeOutput;
  unload?: () => Promise<void> | void;
}

export interface FakeSession extends RunnerSession {
  calls: string[];
  closed: boolean;
}

const OK_LOAD: LoadStats = { loadMs: 120 };

export function completion(text: string, extra: Partial<CompletionOutput> = {}): CompletionOutput {
  return { text, wallMs: 40, ttftMs: 10, tokensPerSecond: 200, generatedTokens: 20, ...extra };
}

export function hangUntilAborted<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_, reject) => {
    const cancelled = () => {
      reject(new Error('inference was cancelled'));
    };
    if (signal.aborted) cancelled();
    signal.addEventListener('abort', cancelled);
  });
}

export function createFakeSession(
  behaviors: Record<string, FakeBehavior>,
  sdkVersion = '0.22.0',
): FakeSession {
  const session: FakeSession = {
    sdkName: '@qvac/sdk',
    sdkVersion,
    calls: [],
    closed: false,
    createRunner(): ModelRunner {
      let current: string | undefined;
      const counters = { complete: 0, embed: 0, transcribe: 0 };
      const behavior = (): FakeBehavior => {
        const found = current === undefined ? undefined : behaviors[current];
        if (found === undefined)
          throw new Error(`No fake behavior for ${current ?? 'an unloaded model'}`);
        return found;
      };
      return {
        async load(model: ResolvedModel, signal: AbortSignal) {
          current = model.id;
          session.calls.push(`load:${model.id}`);
          return (await behavior().load?.(signal)) ?? OK_LOAD;
        },
        async complete(request, signal) {
          session.calls.push(`complete:${current ?? ''}`);
          const handler = behavior().complete;
          if (handler === undefined) throw new Error('complete is not scripted');
          return handler(request, signal, counters.complete++);
        },
        async embed(texts, signal) {
          session.calls.push(`embed:${current ?? ''}`);
          const handler = behavior().embed;
          if (handler === undefined) throw new Error('embed is not scripted');
          return handler(texts, signal, counters.embed++);
        },
        async transcribe(path, signal) {
          session.calls.push(`transcribe:${current ?? ''}`);
          const handler = behavior().transcribe;
          if (handler === undefined) throw new Error('transcribe is not scripted');
          return handler(path, signal, counters.transcribe++);
        },
        async unload() {
          session.calls.push(`unload:${current ?? ''}`);
          await behavior().unload?.();
        },
      };
    },
    close() {
      session.closed = true;
      return Promise.resolve();
    },
  };
  return session;
}

export const noMemory = (): MemorySampler => ({
  start: () => undefined,
  stop: () => Promise.resolve(512),
});
