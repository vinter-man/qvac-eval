export interface SdkProgress {
  percentage: number;
  downloaded: number;
  total: number;
}

export interface SdkCompletionStats {
  timeToFirstToken?: number;
  tokensPerSecond?: number;
  generatedTokens?: number;
  promptTokens?: number;
  backendDevice?: string;
}

export interface SdkCompletionEvent {
  type: string;
}

export interface SdkCompletionRun {
  requestId: string;
  events: AsyncIterable<SdkCompletionEvent>;
  final: Promise<{
    contentText: string;
    stats?: SdkCompletionStats;
    stopReason?: string;
  }>;
}

export interface SdkTranscribeStats {
  audioDuration?: number;
  realTimeFactor?: number;
}

export type Tracked<T> = Promise<T> & { requestId: string };

export interface SdkLoadOptions {
  modelSrc: unknown;
  modelType?: string;
  modelConfig?: Record<string, unknown>;
  onProgress?: (progress: SdkProgress) => void;
}

export interface SdkCompletionOptions {
  modelId: string;
  history: { role: string; content: string }[];
  stream: true;
  generationParams: Record<string, number>;
  responseFormat?: Record<string, unknown>;
}

export interface QvacSdk {
  loadModel(options: SdkLoadOptions): Tracked<string>;
  unloadModel(options: {
    modelId: string;
    clearStorage?: boolean;
    autoClose?: boolean;
  }): Promise<void>;
  completion(options: SdkCompletionOptions): SdkCompletionRun;
  embed(options: { modelId: string; text: string[] }): Tracked<{
    embedding: number[] | number[][];
  }>;
  transcribe(options: { modelId: string; audioChunk: string }): Tracked<string> & {
    stats?: Promise<SdkTranscribeStats | undefined>;
  };
  cancel(options: { requestId: string }): Promise<void>;
  close?(): Promise<void>;
  heartbeat?(): Promise<unknown>;
}

export type QvacSdkModule = QvacSdk & Record<string, unknown>;
