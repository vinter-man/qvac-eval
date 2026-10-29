import type { ResolvedModel } from '../suites/load.js';
import type { Generation, Message, ResponseFormat } from '../suites/schema.js';

export type Device = 'cpu' | 'gpu' | 'auto';

export interface LoadStats {
  loadMs: number;
  downloadMs?: number;
}

export interface CompletionRequest {
  messages: Message[];
  generation: Generation;
  responseFormat?: ResponseFormat;
}

export interface CompletionOutput {
  text: string;
  wallMs: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  generatedTokens?: number;
  stopReason?: string;
  backend?: string;
}

export interface EmbedOutput {
  vectors: number[][];
  wallMs: number;
}

export interface TranscribeOutput {
  text: string;
  wallMs: number;
  audioMs?: number;
  realTimeFactor?: number;
}

export interface ModelRunner {
  load(model: ResolvedModel, signal: AbortSignal): Promise<LoadStats>;
  complete(request: CompletionRequest, signal: AbortSignal): Promise<CompletionOutput>;
  embed(texts: readonly string[], signal: AbortSignal): Promise<EmbedOutput>;
  transcribe(audioPath: string, signal: AbortSignal): Promise<TranscribeOutput>;
  unload(): Promise<void>;
}

export interface RunnerSession {
  readonly sdkName: string;
  readonly sdkVersion: string;
  createRunner(): ModelRunner;
  close(): Promise<void>;
}
