import type { Device, LoadStats, RunnerSession } from '../adapter/types.js';
import { describeError, InfraError } from '../errors.js';
import { distribution, sum } from '../metrics/stats.js';
import type { CaseResult, ModelRun, Perf, RunReport } from '../report/schema.js';
import { summarize, verdictFor } from '../report/summary.js';
import { casesForModel, type LoadedSuite, type ResolvedModel } from '../suites/load.js';
import { TOOL_VERSION } from '../version.js';
import type { CaseDefinition, EvalConfig } from '../suites/schema.js';
import {
  assertFixturesExist,
  MIN_TOKENS_FOR_RATE,
  runCase,
  type CaseOutcome,
  type CasePerf,
} from './cases.js';
import { findGolden, saveGolden, type GoldenEntry, type GoldenFile } from './golden.js';
import type { MemorySamplerFactory } from './memory.js';
import { withTimeout } from './timeout.js';

export type ProgressEvent =
  | { type: 'model-start'; model: ResolvedModel; cases: number }
  | { type: 'model-loaded'; model: ResolvedModel; stats: LoadStats }
  | { type: 'case-done'; model: ResolvedModel; result: CaseResult }
  | { type: 'model-done'; run: ModelRun }
  | {
      type: 'golden-saved';
      model: ResolvedModel;
      file: string;
      written: number;
      skipped: string[];
    };

export interface RunSettings {
  suite: LoadedSuite;
  models: readonly ResolvedModel[];
  session: RunnerSession;
  config: EvalConfig;
  repeat: number;
  device: Device;
  goldenDir: string;
  updateGolden: boolean;
  cwd: string;
  signal: AbortSignal;
  createSampler: MemorySamplerFactory;
  environment: Omit<RunReport['environment'], 'sdk'>;
  now: () => Date;
  onProgress: (event: ProgressEvent) => void;
}

export class InterruptedError extends Error {
  constructor() {
    super('Interrupted');
    this.name = 'InterruptedError';
  }
}

function throwIfInterrupted(signal: AbortSignal): void {
  if (signal.aborted) throw new InterruptedError();
}

function modelIdentity(model: ResolvedModel): ModelRun['model'] {
  return {
    id: model.id,
    kind: model.kind,
    source: model.source,
    ...(model.license !== undefined && { license: model.license }),
    ...(model.sizeMb !== undefined && { sizeMb: model.sizeMb }),
  };
}

function aggregateRate(perf: readonly CasePerf[]): number | undefined {
  const reliable = perf
    .flatMap((entry) => entry.rates)
    .filter((rate) => rate.tokens >= MIN_TOKENS_FOR_RATE && rate.tokensPerSecond > 0);
  if (reliable.length === 0) return undefined;
  const seconds = sum(reliable.map((rate) => rate.tokens / rate.tokensPerSecond));
  return sum(reliable.map((rate) => rate.tokens)) / seconds;
}

function buildPerf(
  load: LoadStats,
  perf: readonly CasePerf[],
  peakRssMb: number | undefined,
): Perf {
  const ttft = distribution(perf.flatMap((entry) => entry.ttftsMs));
  const latency = distribution(perf.flatMap((entry) => entry.latenciesMs));
  const tokensPerSecond = aggregateRate(perf);
  return {
    loadMs: load.loadMs,
    ...(load.downloadMs !== undefined && { downloadMs: load.downloadMs }),
    ...(ttft !== undefined && { ttftMs: ttft }),
    ...(tokensPerSecond !== undefined && { tokensPerSecond }),
    ...(latency !== undefined && { latencyMs: latency }),
    ...(peakRssMb !== undefined && { peakRssMb }),
  };
}

function acceptable(outcome: CaseOutcome): boolean {
  return (
    outcome.result.status !== 'errored' && outcome.result.checks.every((check) => check.passed)
  );
}

async function runModel(
  model: ResolvedModel,
  cases: readonly CaseDefinition[],
  settings: RunSettings,
): Promise<ModelRun> {
  const { session, signal } = settings;
  const suiteName = settings.suite.definition.suite;
  const sdkVersion = session.sdkVersion;
  const golden: GoldenFile | undefined = settings.updateGolden
    ? undefined
    : await findGolden(settings.goldenDir, model.id, suiteName, sdkVersion);

  settings.onProgress({ type: 'model-start', model, cases: cases.length });
  const sampler = settings.createSampler();
  sampler.start();
  const runner = session.createRunner();

  let loadStats: LoadStats | undefined;
  const outcomes: CaseOutcome[] = [];
  let failure: unknown;
  try {
    loadStats = await withTimeout(settings.config.timeouts.loadMs, signal, (inner) =>
      runner.load(model, inner),
    );
    settings.onProgress({ type: 'model-loaded', model, stats: loadStats });

    for (const testCase of cases) {
      throwIfInterrupted(signal);
      const outcome = await runCase(testCase, {
        runner,
        model,
        suite: settings.suite.definition,
        config: settings.config,
        repeat: settings.repeat,
        signal,
        cwd: settings.cwd,
        ...(golden !== undefined && { golden }),
      });
      outcomes.push(outcome);
      settings.onProgress({ type: 'case-done', model, result: outcome.result });
    }
  } catch (error) {
    failure = error;
  }

  let unloadNote: string | undefined;
  try {
    await runner.unload();
  } catch (error) {
    unloadNote = `unloading the model failed: ${describeError(error)}`;
  }
  const peakRssMb = await sampler.stop();

  throwIfInterrupted(signal);
  if (failure !== undefined) {
    if (loadStats !== undefined && !(failure instanceof InfraError)) {
      throw failure instanceof Error ? failure : new Error(describeError(failure));
    }
    return {
      model: modelIdentity(model),
      status: 'infra-error',
      note:
        failure instanceof InfraError
          ? failure.message
          : `model failed to load: ${describeError(failure)}`,
      regressions: [],
      cases: outcomes.map((outcome) => outcome.result),
    };
  }
  if (loadStats === undefined) throw new Error('Model finished without load statistics');

  const savedNote = settings.updateGolden
    ? await recordGolden(model, outcomes, settings)
    : undefined;
  const backend =
    outcomes.find((outcome) => outcome.backend !== undefined)?.backend ?? loadStats.backend;
  const note = [unloadNote, savedNote].filter((entry) => entry !== undefined).join('; ');
  return {
    model: modelIdentity(model),
    status: 'completed',
    ...(note !== '' && { note }),
    ...(backend !== undefined && { backend }),
    ...(golden !== undefined && { goldenSdk: golden.sdk }),
    perf: buildPerf(
      loadStats,
      outcomes.map((outcome) => outcome.perf),
      peakRssMb,
    ),
    regressions: [],
    cases: outcomes.map((outcome) => outcome.result),
  };
}

async function recordGolden(
  model: ResolvedModel,
  outcomes: readonly CaseOutcome[],
  settings: RunSettings,
): Promise<string | undefined> {
  const recorded: Record<string, GoldenEntry> = {};
  const skipped: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.golden === undefined) continue;
    if (acceptable(outcome)) recorded[outcome.result.id] = outcome.golden;
    else skipped.push(outcome.result.id);
  }
  if (Object.keys(recorded).length === 0) {
    return skipped.length > 0
      ? 'golden not updated: no case passed its checks'
      : 'golden not updated: no case asks for a golden';
  }
  const { file, written } = await saveGolden(settings.goldenDir, {
    schemaVersion: 1,
    suite: settings.suite.definition.suite,
    model: model.id,
    sdk: settings.session.sdkVersion,
    recordedAt: settings.now().toISOString(),
    cases: recorded,
  });
  settings.onProgress({ type: 'golden-saved', model, file, written, skipped });
  return undefined;
}

export async function runSuite(settings: RunSettings): Promise<RunReport> {
  const startedAt = settings.now();
  const plan = settings.models.map((model) => ({
    model,
    cases: casesForModel(settings.suite.definition, model),
  }));
  await assertFixturesExist(
    plan.flatMap((entry) => entry.cases),
    settings.cwd,
  );

  const models: ModelRun[] = [];
  for (const { model, cases } of plan) {
    throwIfInterrupted(settings.signal);
    if (cases.length === 0) {
      const run: ModelRun = {
        model: modelIdentity(model),
        status: 'skipped',
        note: `the suite has no cases for ${model.kind} models`,
        regressions: [],
        cases: [],
      };
      models.push(run);
      settings.onProgress({ type: 'model-done', run });
      continue;
    }
    const run = await runModel(model, cases, settings);
    models.push(run);
    settings.onProgress({ type: 'model-done', run });
  }

  const summary = summarize(models);
  return {
    schemaVersion: 1,
    tool: { name: 'qvac-eval', version: TOOL_VERSION },
    suite: { name: settings.suite.definition.suite, file: settings.suite.file },
    startedAt: startedAt.toISOString(),
    finishedAt: settings.now().toISOString(),
    options: { repeat: settings.repeat, device: settings.device },
    environment: {
      ...settings.environment,
      sdk: { name: settings.session.sdkName, version: settings.session.sdkVersion },
    },
    models,
    summary,
    verdict: verdictFor(models, summary),
  };
}
