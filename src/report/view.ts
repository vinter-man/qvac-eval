import {
  formatMegabytes,
  formatMs,
  formatNumber,
  formatRate,
  formatSignedPercent,
} from '../format.js';
import { NOISE_FLOOR } from '../run/baseline.js';
import type { ModelKind } from '../suites/schema.js';
import type { CaseComparison, Comparison, Delta, ModelComparison } from './compare.js';
import type { CaseResult, ModelRun, Regression, RunReport, Summary, Verdict } from './schema.js';

export interface ViewCell {
  text: string;
  was?: string;
  changePct?: number;
  worse?: boolean;
}

export interface PerfRow {
  id: string;
  kind: ModelKind;
  subtitle: string;
  status: ModelRun['status'];
  note?: string;
  load: ViewCell;
  ttft: ViewCell;
  tokens: ViewCell;
  p50: ViewCell;
  p95: ViewCell;
  rss: ViewCell;
}

interface RegressionRow {
  model: string;
  caseId?: string;
  metric: string;
  message: string;
  source: Regression['source'];
}

export interface CaseRow {
  model: ModelRun['model'];
  result: CaseResult;
  older?: CaseResult;
  outputSimilarity?: number;
}

interface Fact {
  label: string;
  value: string;
}

export interface ChartPoint {
  model: string;
  older?: number;
  newer?: number;
}

export interface ReportView {
  suite: string;
  comparedAgainst: string;
  verdict: { word: string; tone: Verdict; sentence: string };
  sdkLabel: string;
  platformLabel: string;
  compared: boolean;
  olderSdk?: string;
  newerSdk: string;
  summary: Summary;
  facts: Fact[];
  perf: PerfRow[];
  tokensChart: ChartPoint[];
  latencyChart: ChartPoint[];
  regressions: RegressionRow[];
  cases: CaseRow[];
  models: string[];
}

const WORSE_BY_AT_LEAST_PCT = 5;

export function caseNote(result: CaseResult): string {
  if (result.error !== undefined) return `${result.error.kind}: ${result.error.message}`;
  const failed = result.checks.find((check) => !check.passed);
  if (failed !== undefined) return failed.detail ?? failed.name;
  return result.regressions[0]?.message ?? '';
}

function comparedAgainstOf(newer: RunReport, olderSdk: string | undefined): string {
  const cases = newer.models.flatMap((run) => run.cases);
  const compared = cases.filter((testCase) => testCase.golden === 'compared').length;
  const missing = cases.filter((testCase) => testCase.golden === 'missing').length;
  const basis = [
    ...(compared > 0 ? ['the golden outputs'] : []),
    ...(olderSdk === undefined
      ? newer.baseline === undefined
        ? []
        : [`the baseline from SDK ${newer.baseline.sdkVersion}`]
      : [`SDK ${olderSdk}`]),
  ];
  const lead =
    basis.length === 0
      ? 'Nothing was compared: there is no golden output and no baseline, so only the expectations of the cases were checked.'
      : `Nothing slipped against ${basis.join(' and ')}.`;
  const gap =
    missing === 0
      ? ''
      : ` ${missing} ${missing === 1 ? 'case asks' : 'cases ask'} for a golden output that is not recorded.`;
  return `${lead}${gap}`;
}

export function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function cell(
  value: number | undefined,
  compared: Delta | undefined,
  format: (value: number) => string,
  lowerIsBetter: boolean,
  floor: number,
): ViewCell {
  const text = value === undefined ? '—' : format(value);
  if (compared?.older === undefined || value === undefined) return { text };
  const change = compared.changePct;
  const moved = Math.abs(value - compared.older) > floor;
  const worse =
    moved &&
    change !== undefined &&
    (lowerIsBetter ? change > WORSE_BY_AT_LEAST_PCT : change < -WORSE_BY_AT_LEAST_PCT);
  return {
    text,
    was: format(compared.older),
    ...(change !== undefined && Number.isFinite(change) && { changePct: change }),
    worse,
  };
}

function subtitleOf(run: ModelRun): string {
  const { model } = run;
  return [
    model.kind === 'llm' ? 'LLM' : model.kind === 'asr' ? 'speech to text' : 'embeddings',
    model.sizeMb === undefined ? undefined : formatMegabytes(model.sizeMb),
    model.license,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}

function perfRow(run: ModelRun, compared: ModelComparison | undefined): PerfRow {
  const { perf } = run;
  return {
    id: run.model.id,
    kind: run.model.kind,
    subtitle: subtitleOf(run),
    status: run.status,
    ...(run.note !== undefined && { note: run.note }),
    load: cell(perf?.loadMs, compared?.loadMs, formatMs, true, NOISE_FLOOR.loadMs),
    ttft: cell(perf?.ttftMs?.p50, compared?.ttftP50, formatMs, true, NOISE_FLOOR.ttftMs),
    tokens: cell(
      perf?.tokensPerSecond,
      compared?.tokensPerSecond,
      formatRate,
      false,
      NOISE_FLOOR.tokensPerSecond,
    ),
    p50: cell(perf?.latencyMs?.p50, compared?.latencyP50, formatMs, true, NOISE_FLOOR.latencyMs),
    p95: cell(perf?.latencyMs?.p95, compared?.latencyP95, formatMs, true, NOISE_FLOOR.latencyMs),
    rss: cell(perf?.peakRssMb, compared?.peakRssMb, formatMegabytes, true, NOISE_FLOOR.peakRssMb),
  };
}

function verdictOf(report: RunReport, older: RunReport | undefined): ReportView['verdict'] {
  const { summary } = report;
  const modelsRun = report.models.filter((run) => run.status === 'completed').length;
  const base = `${summary.passed} of ${summary.total} cases passed on ${modelsRun} ${modelsRun === 1 ? 'model' : 'models'}`;
  if (report.verdict === 'error') {
    const own = report.models.some((run) => run.status === 'infra-error')
      ? ' A model did not finish, so this result is incomplete.'
      : '';
    const unfinishedOlder = (older?.models ?? [])
      .filter((run) => run.status === 'infra-error')
      .map((run) => run.model.id);
    const theirs =
      older === undefined || unfinishedOlder.length === 0
        ? ''
        : ` The report of SDK ${older.environment.sdk.version} is incomplete (${unfinishedOlder.join(', ')}), so the comparison is too.`;
    return { word: 'Error', tone: 'error', sentence: `${base}.${own}${theirs}` };
  }
  if (report.verdict === 'pass') return { word: 'Passed', tone: 'pass', sentence: `${base}.` };

  const parts: string[] = [];
  if (summary.failed + summary.errored > 0)
    parts.push(`${summary.failed + summary.errored} failed`);
  if (summary.regressed > 0) parts.push(`${summary.regressed} regressed`);
  if (summary.modelRegressions > 0)
    parts.push(`${summary.modelRegressions} slower or heavier than the baseline`);
  const word = summary.failed + summary.errored > 0 ? 'Failed' : 'Regressed';
  return { word, tone: 'fail', sentence: `${base}; ${parts.join(', ')}.` };
}

function runnerLabel(report: RunReport): string {
  const { environment } = report;
  const runner = environment.ci?.runner;
  return runner ?? `${environment.platform} ${environment.arch}`;
}

function factsOf(newer: RunReport, older: RunReport | undefined): Fact[] {
  const { environment } = newer;
  const facts: Fact[] = [
    { label: 'Suite', value: newer.suite.name },
    { label: 'SDK', value: `${environment.sdk.name} ${environment.sdk.version}` },
    { label: 'Started', value: formatUtc(newer.startedAt) },
    { label: 'Duration', value: formatDuration(newer.startedAt, newer.finishedAt) },
    { label: 'Node.js', value: environment.node },
    { label: 'System', value: `${environment.platform} ${environment.arch}` },
    ...(environment.cpu === undefined ? [] : [{ label: 'CPU', value: environment.cpu }]),
    {
      label: 'Resources',
      value: `${environment.cpuCount} cores · ${formatMegabytes(environment.memoryMb)} RAM`,
    },
    { label: 'Inference on', value: newer.options.device },
    { label: 'Repeats per case', value: String(newer.options.repeat) },
  ];
  if (environment.ci?.runner !== undefined)
    facts.push({ label: 'Runner', value: environment.ci.runner });
  if (environment.ci?.ref !== undefined) {
    const sha = environment.ci.sha === undefined ? '' : ` @ ${environment.ci.sha}`;
    facts.push({ label: 'Ref', value: `${environment.ci.ref}${sha}` });
  }
  if (older !== undefined) {
    facts.push({
      label: 'Compared with',
      value: `SDK ${older.environment.sdk.version} (${formatUtc(older.startedAt)})`,
    });
  } else if (newer.baseline !== undefined) {
    facts.push({
      label: 'Baseline',
      value: `SDK ${newer.baseline.sdkVersion} (${formatUtc(newer.baseline.startedAt)})`,
    });
  }
  const goldens = [
    ...new Set(newer.models.flatMap((run) => (run.goldenSdk === undefined ? [] : [run.goldenSdk]))),
  ];
  if (goldens.length > 0)
    facts.push({ label: 'Golden outputs from', value: `SDK ${goldens.join(', ')}` });
  return facts;
}

function regressionRows(report: RunReport): RegressionRow[] {
  return report.models.flatMap((run) => [
    ...run.regressions.map((regression) => ({
      model: run.model.id,
      metric: regression.metric,
      message: regression.message,
      source: regression.source,
    })),
    ...run.cases.flatMap((testCase) =>
      testCase.regressions.map((regression) => ({
        model: run.model.id,
        caseId: testCase.id,
        metric: regression.metric,
        message: regression.message,
        source: regression.source,
      })),
    ),
  ]);
}

function caseRows(report: RunReport, cases: readonly CaseComparison[] | undefined): CaseRow[] {
  return report.models.flatMap((run) =>
    run.cases.map((result) => {
      const matched = cases?.find(
        (entry) => entry.model === run.model.id && entry.id === result.id,
      );
      return {
        model: run.model,
        result,
        ...(matched?.older !== undefined && { older: matched.older }),
        ...(matched?.outputSimilarity !== undefined && {
          outputSimilarity: matched.outputSimilarity,
        }),
      };
    }),
  );
}

function chartPoints(
  models: readonly ModelComparison[],
  pick: (model: ModelComparison) => Delta,
): ChartPoint[] {
  return models
    .filter((model) => {
      const delta = pick(model);
      return delta.newer !== undefined || delta.older !== undefined;
    })
    .map((model) => {
      const delta = pick(model);
      return {
        model: model.id,
        ...(delta.older !== undefined && { older: delta.older }),
        ...(delta.newer !== undefined && { newer: delta.newer }),
      };
    });
}

function singleModelComparisons(report: RunReport): ModelComparison[] {
  return report.models.map((run) => ({
    id: run.model.id,
    newer: run,
    loadMs: { ...(run.perf !== undefined && { newer: run.perf.loadMs }) },
    tokensPerSecond: {
      ...(run.perf?.tokensPerSecond !== undefined && { newer: run.perf.tokensPerSecond }),
    },
    ttftP50: { ...(run.perf?.ttftMs !== undefined && { newer: run.perf.ttftMs.p50 }) },
    latencyP50: { ...(run.perf?.latencyMs !== undefined && { newer: run.perf.latencyMs.p50 }) },
    latencyP95: { ...(run.perf?.latencyMs !== undefined && { newer: run.perf.latencyMs.p95 }) },
    peakRssMb: { ...(run.perf?.peakRssMb !== undefined && { newer: run.perf.peakRssMb }) },
  }));
}

export function buildView(report: RunReport, comparison?: Comparison): ReportView {
  const newer = comparison?.newer ?? report;
  const older = comparison?.older;
  const models = comparison?.models ?? singleModelComparisons(newer);
  const newerSdk = newer.environment.sdk.version;
  const olderSdk = older?.environment.sdk.version;
  const chartable = models.filter((model) => (model.newer ?? model.older)?.status === 'completed');

  return {
    suite: newer.suite.name,
    comparedAgainst: comparedAgainstOf(newer, olderSdk),
    verdict: verdictOf(newer, older),
    sdkLabel: olderSdk === undefined ? `SDK ${newerSdk}` : `SDK ${olderSdk} → ${newerSdk}`,
    platformLabel: runnerLabel(newer),
    compared: older !== undefined,
    ...(olderSdk !== undefined && { olderSdk }),
    newerSdk,
    summary: newer.summary,
    facts: factsOf(newer, older),
    perf: newer.models.map((run) =>
      perfRow(
        run,
        models.find((entry) => entry.id === run.model.id),
      ),
    ),
    tokensChart: chartPoints(chartable, (model) => model.tokensPerSecond),
    latencyChart: chartPoints(chartable, (model) => model.latencyP50),
    regressions: regressionRows(newer),
    cases: caseRows(newer, comparison?.cases),
    models: newer.models.map((run) => run.model.id),
  };
}

export function describeChange(changePct: number | undefined): string | undefined {
  if (changePct === undefined) return undefined;
  if (Math.abs(changePct) < 0.05) return '±0%';
  return formatSignedPercent(changePct);
}

export function formatSimilarity(similarity: number): string {
  return similarity === 1
    ? 'identical output'
    : `output ${formatNumber(similarity * 100, 0)}% similar`;
}
