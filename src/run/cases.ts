import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CompletionOutput,
  CompletionRequest,
  EmbedOutput,
  ModelRunner,
  TranscribeOutput,
} from '../adapter/types.js';
import { CaseTimeoutError, describeError, InfraError, UsageError } from '../errors.js';
import { formatNumber } from '../format.js';
import {
  checkCompletion,
  checkEmbedding,
  checkTranscription,
  pairSimilarity,
  type Evaluated,
} from '../metrics/checks.js';
import {
  compareTextWithGolden,
  compareVectorsWithGolden,
  type GoldenComparison,
} from '../metrics/golden.js';
import { median } from '../metrics/stats.js';
import { wordErrorRate } from '../metrics/text.js';
import { euclideanNorm } from '../metrics/vector.js';
import type { CaseMetrics, CaseResult } from '../report/schema.js';
import type { ResolvedModel } from '../suites/load.js';
import {
  generationSchema,
  type CaseDefinition,
  type CompletionCase,
  type EmbedCase,
  type EvalConfig,
  type Generation,
  type GoldenTolerance,
  type Message,
  type SuiteDefinition,
  type TranscribeCase,
} from '../suites/schema.js';
import type { GoldenEntry, GoldenFile } from './golden.js';
import { withTimeout } from './timeout.js';

export const MIN_TOKENS_FOR_RATE = 16;
export const OUTPUT_LIMIT = 4000;

const BUILT_IN_GENERATION: Generation = { temperature: 0, seed: 42, maxTokens: 64 };

export interface RateSample {
  tokens: number;
  tokensPerSecond: number;
}

export interface CasePerf {
  latenciesMs: number[];
  ttftsMs: number[];
  rates: RateSample[];
}

export interface CaseOutcome {
  result: CaseResult;
  perf: CasePerf;
  golden?: GoldenEntry;
  backend?: string;
}

export interface CaseContext {
  runner: ModelRunner;
  model: ResolvedModel;
  suite: SuiteDefinition;
  config: EvalConfig;
  repeat: number;
  signal: AbortSignal;
  cwd: string;
  golden?: GoldenFile;
}

type Sampled<T> = { samples: T[]; error?: undefined } | { samples: T[]; error: SampleError };

interface SampleError {
  kind: 'timeout' | 'sdk';
  message: string;
}

function clip(text: string): string {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}…` : text;
}

const GENERATION_KEYS = new Set(Object.keys(generationSchema.shape));

function suiteGeneration(suite: SuiteDefinition): Generation {
  const entries = Object.entries(suite.defaults ?? {}).filter(([key]) => GENERATION_KEYS.has(key));
  return generationSchema.parse(Object.fromEntries(entries));
}

function mergeGeneration(
  model: Generation,
  suite: SuiteDefinition,
  testCase: CompletionCase,
): Generation {
  return { ...BUILT_IN_GENERATION, ...model, ...suiteGeneration(suite), ...testCase.generation };
}

function timeoutFor(testCase: CaseDefinition, suite: SuiteDefinition, config: EvalConfig): number {
  return testCase.timeoutMs ?? suite.defaults?.timeoutMs ?? config.timeouts.caseMs;
}

function toMessages(input: CompletionCase['input']): Message[] {
  return typeof input === 'string' ? [{ role: 'user', content: input }] : input;
}

export function audioPath(testCase: TranscribeCase, cwd: string): string {
  return resolve(cwd, testCase.input);
}

export async function assertFixturesExist(
  cases: readonly CaseDefinition[],
  cwd: string,
): Promise<void> {
  const missing: string[] = [];
  for (const testCase of cases) {
    if (testCase.kind !== 'transcribe') continue;
    try {
      await access(audioPath(testCase, cwd));
    } catch {
      missing.push(`${testCase.id}: ${testCase.input}`);
    }
  }
  if (missing.length > 0) {
    throw new UsageError(
      'Audio fixtures not found (paths are relative to the working directory)',
      missing,
    );
  }
}

async function sample<T>(
  attempts: number,
  timeoutMs: number,
  context: CaseContext,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<Sampled<T>> {
  const samples: T[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      samples.push(await withTimeout(timeoutMs, context.signal, work));
    } catch (error) {
      if (context.signal.aborted || error instanceof InfraError) throw error;
      const kind = error instanceof CaseTimeoutError ? 'timeout' : 'sdk';
      return { samples, error: { kind, message: describeError(error) } };
    }
  }
  return { samples };
}

function emptyPerf(): CasePerf {
  return { latenciesMs: [], ttftsMs: [], rates: [] };
}

function erroredOutcome(
  testCase: CaseDefinition,
  perf: CasePerf,
  attempts: number,
  error: SampleError,
): CaseOutcome {
  return {
    perf,
    result: {
      id: testCase.id,
      kind: testCase.kind,
      ...(testCase.description !== undefined && { description: testCase.description }),
      status: 'errored',
      attempts,
      checks: [],
      regressions: [],
      error,
    },
  };
}

function goldenEntryFor(context: CaseContext, testCase: CaseDefinition): GoldenEntry | undefined {
  return context.golden?.cases[testCase.id];
}

function toleranceOf(
  tolerance: GoldenTolerance | undefined,
  key: 'minSimilarity' | 'minCosine',
  fallback: number,
) {
  if (tolerance === undefined) return undefined;
  return tolerance === true ? fallback : (tolerance[key] ?? fallback);
}

function settle(
  testCase: CaseDefinition,
  attempts: number,
  evaluated: Evaluated,
  golden: GoldenComparison | undefined,
  metrics: CaseMetrics,
  output: string,
): CaseResult {
  const failed = evaluated.checks.some((check) => !check.passed);
  const regressions = golden?.regressions ?? [];
  const diff = evaluated.diff ?? golden?.diff;
  return {
    id: testCase.id,
    kind: testCase.kind,
    ...(testCase.description !== undefined && { description: testCase.description }),
    status: failed ? 'failed' : regressions.length > 0 ? 'regressed' : 'passed',
    attempts,
    checks: evaluated.checks,
    regressions,
    metrics,
    output: clip(output),
    ...(diff !== undefined && { diff }),
  };
}

function rateSamples(outputs: readonly CompletionOutput[]): RateSample[] {
  return outputs.flatMap((output) =>
    output.generatedTokens !== undefined && output.tokensPerSecond !== undefined
      ? [{ tokens: output.generatedTokens, tokensPerSecond: output.tokensPerSecond }]
      : [],
  );
}

function definedValues(values: readonly (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined);
}

async function runCompletion(testCase: CompletionCase, context: CaseContext): Promise<CaseOutcome> {
  const generation = mergeGeneration(context.model.generation, context.suite, testCase);
  const request: CompletionRequest = {
    messages: toMessages(testCase.input),
    generation,
    ...(testCase.responseFormat !== undefined && { responseFormat: testCase.responseFormat }),
  };
  const deterministic = testCase.expect.deterministic;
  const attempts = deterministic === true ? Math.max(context.repeat, 2) : context.repeat;

  const sampled = await sample(
    attempts,
    timeoutFor(testCase, context.suite, context.config),
    context,
    (signal) => context.runner.complete(request, signal),
  );
  const outputs: CompletionOutput[] = sampled.samples;
  const perf: CasePerf = {
    latenciesMs: outputs.map((output) => output.wallMs),
    ttftsMs: definedValues(outputs.map((output) => output.ttftMs)),
    rates: rateSamples(outputs),
  };
  if (sampled.error !== undefined)
    return erroredOutcome(testCase, perf, outputs.length + 1, sampled.error);

  const first = outputs[0];
  if (first === undefined) throw new Error('No completion attempt was made');
  const texts = outputs.map((output) => output.text);
  const latencyMs = median(perf.latenciesMs) ?? first.wallMs;
  const ttftMs = median(perf.ttftsMs);
  const tokensPerSecond = median(definedValues(outputs.map((output) => output.tokensPerSecond)));

  const evaluated = checkCompletion(
    testCase.expect,
    {
      outputs: texts,
      latencyMs,
      ...(ttftMs !== undefined && { ttftMs }),
      ...(tokensPerSecond !== undefined && { tokensPerSecond }),
    },
    attempts > 1 && (deterministic ?? generation.temperature === 0),
  );

  const entry = goldenEntryFor(context, testCase);
  const minSimilarity = toleranceOf(testCase.expect.golden, 'minSimilarity', 0.85);
  const comparison =
    entry !== undefined && minSimilarity !== undefined && context.golden !== undefined
      ? compareTextWithGolden(entry, first.text, minSimilarity, context.golden.sdk)
      : undefined;

  const metrics: CaseMetrics = {
    latencyMs,
    ...(ttftMs !== undefined && { ttftMs }),
    ...(tokensPerSecond !== undefined && { tokensPerSecond }),
    ...(first.generatedTokens !== undefined && { generatedTokens: first.generatedTokens }),
    ...(comparison?.similarity !== undefined && { goldenSimilarity: comparison.similarity }),
  };

  return {
    perf,
    ...(first.backend !== undefined && { backend: first.backend }),
    ...(testCase.expect.golden !== undefined && {
      golden: { kind: 'completion', text: first.text },
    }),
    result: settle(testCase, attempts, evaluated, comparison, metrics, first.text),
  };
}

function describeVectors(vectors: readonly (readonly number[])[]): string {
  const norms = vectors.map((vector) => formatNumber(euclideanNorm(vector), 4)).join(', ');
  return `${vectors.length} × ${vectors[0]?.length ?? 0}, norms ${norms}`;
}

async function runEmbedding(testCase: EmbedCase, context: CaseContext): Promise<CaseOutcome> {
  const sampled = await sample(
    context.repeat,
    timeoutFor(testCase, context.suite, context.config),
    context,
    (signal) => context.runner.embed(testCase.input, signal),
  );
  const outputs: EmbedOutput[] = sampled.samples;
  const perf: CasePerf = { ...emptyPerf(), latenciesMs: outputs.map((output) => output.wallMs) };
  if (sampled.error !== undefined)
    return erroredOutcome(testCase, perf, outputs.length + 1, sampled.error);

  const first = outputs[0];
  if (first === undefined) throw new Error('No embedding attempt was made');
  const latencyMs = median(perf.latenciesMs) ?? first.wallMs;
  const evaluated = checkEmbedding(testCase.expect, { vectors: first.vectors, latencyMs });

  const entry = goldenEntryFor(context, testCase);
  const minCosine = toleranceOf(testCase.expect.golden, 'minCosine', 0.98);
  const comparison =
    entry !== undefined && minCosine !== undefined && context.golden !== undefined
      ? compareVectorsWithGolden(entry, first.vectors, minCosine, context.golden.sdk)
      : undefined;

  const pairCosine = first.vectors.length >= 2 ? pairSimilarity(first.vectors, [0, 1]) : undefined;
  const metrics: CaseMetrics = {
    latencyMs,
    ...(pairCosine !== undefined && { cosine: pairCosine }),
    ...(comparison?.similarity !== undefined && { goldenSimilarity: comparison.similarity }),
  };

  return {
    perf,
    ...(first.backend !== undefined && { backend: first.backend }),
    ...(testCase.expect.golden !== undefined && {
      golden: {
        kind: 'embed',
        vectors: first.vectors.map((vector) => vector.map((value) => Number(value.toFixed(6)))),
      },
    }),
    result: settle(
      testCase,
      context.repeat,
      evaluated,
      comparison,
      metrics,
      describeVectors(first.vectors),
    ),
  };
}

async function runTranscription(
  testCase: TranscribeCase,
  context: CaseContext,
): Promise<CaseOutcome> {
  const file = audioPath(testCase, context.cwd);
  const sampled = await sample(
    context.repeat,
    timeoutFor(testCase, context.suite, context.config),
    context,
    (signal) => context.runner.transcribe(file, signal),
  );
  const outputs: TranscribeOutput[] = sampled.samples;
  const perf: CasePerf = { ...emptyPerf(), latenciesMs: outputs.map((output) => output.wallMs) };
  if (sampled.error !== undefined)
    return erroredOutcome(testCase, perf, outputs.length + 1, sampled.error);

  const first = outputs[0];
  if (first === undefined) throw new Error('No transcription attempt was made');
  const latencyMs = median(perf.latenciesMs) ?? first.wallMs;
  const realTimeFactor =
    first.realTimeFactor ??
    (first.audioMs !== undefined && first.audioMs > 0 ? first.wallMs / first.audioMs : undefined);
  const evaluated = checkTranscription(testCase.expect, {
    text: first.text,
    latencyMs,
    ...(realTimeFactor !== undefined && { realTimeFactor }),
  });

  const entry = goldenEntryFor(context, testCase);
  const minSimilarity = toleranceOf(testCase.expect.golden, 'minSimilarity', 0.85);
  const comparison =
    entry !== undefined && minSimilarity !== undefined && context.golden !== undefined
      ? compareTextWithGolden(entry, first.text, minSimilarity, context.golden.sdk)
      : undefined;

  const metrics: CaseMetrics = {
    latencyMs,
    ...(testCase.expect.reference !== undefined && {
      wer: wordErrorRate(testCase.expect.reference, first.text),
    }),
    ...(realTimeFactor !== undefined && { realTimeFactor }),
    ...(comparison?.similarity !== undefined && { goldenSimilarity: comparison.similarity }),
  };

  return {
    perf,
    ...(testCase.expect.golden !== undefined && {
      golden: { kind: 'transcribe', text: first.text },
    }),
    result: settle(testCase, context.repeat, evaluated, comparison, metrics, first.text),
  };
}

export async function runCase(
  testCase: CaseDefinition,
  context: CaseContext,
): Promise<CaseOutcome> {
  switch (testCase.kind) {
    case 'completion':
      return runCompletion(testCase, context);
    case 'embed':
      return runEmbedding(testCase, context);
    case 'transcribe':
      return runTranscription(testCase, context);
  }
}
