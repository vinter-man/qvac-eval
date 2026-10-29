import {
  formatMegabytes,
  formatMs,
  formatNumber,
  formatRate,
  formatSignedPercent,
} from '../format.js';
import { percentChange } from '../metrics/stats.js';
import type { CaseResult, ModelRun, Perf, Regression, RunReport } from '../report/schema.js';
import { summarize, verdictFor } from '../report/summary.js';
import type { Thresholds } from '../suites/schema.js';

export const NOISE_FLOOR = {
  tokensPerSecond: 1,
  ttftMs: 20,
  latencyMs: 100,
  loadMs: 500,
  peakRssMb: 64,
} as const;

function baselineRegression(
  metric: string,
  message: string,
  baseline: number,
  current: number,
): Regression {
  return { source: 'baseline', metric, message, baseline, current };
}

function worseByRise(
  metric: string,
  label: string,
  format: (value: number) => string,
  baseline: number | undefined,
  current: number | undefined,
  limitPct: number,
  floor: number,
): Regression[] {
  if (baseline === undefined || current === undefined) return [];
  const change = percentChange(baseline, current);
  if (current - baseline <= floor || change <= limitPct) return [];
  return [
    baselineRegression(
      metric,
      `${label} rose ${formatSignedPercent(change)} (${format(baseline)} → ${format(current)}, limit +${limitPct}%)`,
      baseline,
      current,
    ),
  ];
}

export function perfRegressions(baseline: Perf, current: Perf, limits: Thresholds): Regression[] {
  const found: Regression[] = [];

  if (baseline.tokensPerSecond !== undefined && current.tokensPerSecond !== undefined) {
    const change = percentChange(baseline.tokensPerSecond, current.tokensPerSecond);
    const drop = baseline.tokensPerSecond - current.tokensPerSecond;
    if (drop > NOISE_FLOOR.tokensPerSecond && -change > limits.tokensPerSecondDropPct) {
      found.push(
        baselineRegression(
          'tokensPerSecond',
          `tokens/s fell ${formatSignedPercent(change)} (${formatRate(baseline.tokensPerSecond)} → ${formatRate(current.tokensPerSecond)}, limit -${limits.tokensPerSecondDropPct}%)`,
          baseline.tokensPerSecond,
          current.tokensPerSecond,
        ),
      );
    }
  }

  found.push(
    ...worseByRise(
      'ttftP50',
      'time to first token p50',
      formatMs,
      baseline.ttftMs?.p50,
      current.ttftMs?.p50,
      limits.ttftIncreasePct,
      NOISE_FLOOR.ttftMs,
    ),
    ...worseByRise(
      'latencyP95',
      'latency p95',
      formatMs,
      baseline.latencyMs?.p95,
      current.latencyMs?.p95,
      limits.latencyP95IncreasePct,
      NOISE_FLOOR.latencyMs,
    ),
    ...worseByRise(
      'loadMs',
      'model load time',
      formatMs,
      baseline.loadMs,
      current.loadMs,
      limits.loadTimeIncreasePct,
      NOISE_FLOOR.loadMs,
    ),
    ...worseByRise(
      'peakRssMb',
      'peak memory',
      formatMegabytes,
      baseline.peakRssMb,
      current.peakRssMb,
      limits.peakRssIncreasePct,
      NOISE_FLOOR.peakRssMb,
    ),
  );
  return found;
}

function caseRegressions(
  baseline: CaseResult,
  current: CaseResult,
  limits: Thresholds,
): Regression[] {
  const found: Regression[] = [];

  if (
    baseline.status === 'passed' &&
    (current.status === 'failed' || current.status === 'errored')
  ) {
    found.push({
      source: 'baseline',
      metric: 'status',
      message: `passed in the baseline, now ${current.status}`,
    });
  }

  const baselineWer = baseline.metrics?.wer;
  const currentWer = current.metrics?.wer;
  if (
    baselineWer !== undefined &&
    currentWer !== undefined &&
    currentWer - baselineWer > limits.werIncrease
  ) {
    found.push(
      baselineRegression(
        'wer',
        `WER rose from ${formatNumber(baselineWer, 3)} to ${formatNumber(currentWer, 3)} (limit +${limits.werIncrease})`,
        baselineWer,
        currentWer,
      ),
    );
  }

  const baselineCosine = baseline.metrics?.cosine;
  const currentCosine = current.metrics?.cosine;
  if (
    baselineCosine !== undefined &&
    currentCosine !== undefined &&
    baselineCosine - currentCosine > limits.cosineDrop
  ) {
    found.push(
      baselineRegression(
        'cosine',
        `pair cosine fell from ${formatNumber(baselineCosine, 4)} to ${formatNumber(currentCosine, 4)} (limit -${limits.cosineDrop})`,
        baselineCosine,
        currentCosine,
      ),
    );
  }

  const baselineSimilarity = baseline.metrics?.goldenSimilarity;
  const currentSimilarity = current.metrics?.goldenSimilarity;
  if (
    baselineSimilarity !== undefined &&
    currentSimilarity !== undefined &&
    baselineSimilarity - currentSimilarity > limits.goldenSimilarityDrop
  ) {
    found.push(
      baselineRegression(
        'goldenSimilarity',
        `similarity to the golden fell from ${formatNumber(baselineSimilarity, 3)} to ${formatNumber(currentSimilarity, 3)} (limit -${limits.goldenSimilarityDrop})`,
        baselineSimilarity,
        currentSimilarity,
      ),
    );
  }

  return found;
}

function withoutBaselineRegressions(testCase: CaseResult): CaseResult {
  const regressions = testCase.regressions.filter((regression) => regression.source === 'golden');
  const status =
    testCase.status === 'regressed' && regressions.length === 0 ? 'passed' : testCase.status;
  return { ...testCase, status, regressions };
}

function compareCase(
  testCase: CaseResult,
  baselineCases: readonly CaseResult[],
  limits: Thresholds,
): CaseResult {
  const base = baselineCases.find(
    (candidate) => candidate.id === testCase.id && candidate.kind === testCase.kind,
  );
  if (base === undefined) return testCase;
  const found = caseRegressions(base, testCase, limits);
  if (found.length === 0) return testCase;
  return {
    ...testCase,
    status: testCase.status === 'passed' ? 'regressed' : testCase.status,
    regressions: [...testCase.regressions, ...found],
  };
}

function compareModel(run: ModelRun, base: ModelRun | undefined, limits: Thresholds): ModelRun {
  const cleaned: ModelRun = {
    ...run,
    regressions: run.regressions.filter((regression) => regression.source === 'golden'),
    cases: run.cases.map(withoutBaselineRegressions),
  };
  if (base?.status !== 'completed' || run.status !== 'completed') return cleaned;
  return {
    ...cleaned,
    regressions: [
      ...cleaned.regressions,
      ...(base.perf !== undefined && run.perf !== undefined
        ? perfRegressions(base.perf, run.perf, limits)
        : []),
    ],
    cases: cleaned.cases.map((testCase) => compareCase(testCase, base.cases, limits)),
  };
}

export function applyBaseline(
  current: RunReport,
  baseline: RunReport,
  limits: Thresholds,
  source?: string,
): RunReport {
  const models = current.models.map((run) =>
    compareModel(
      run,
      baseline.models.find((candidate) => candidate.model.id === run.model.id),
      limits,
    ),
  );
  const summary = summarize(models);
  return {
    ...current,
    baseline: {
      sdkVersion: baseline.environment.sdk.version,
      startedAt: baseline.startedAt,
      ...(source !== undefined && { source }),
    },
    models,
    summary,
    verdict: verdictFor(models, summary),
  };
}
