import { percentChange } from '../metrics/stats.js';
import { normalizedSimilarity } from '../metrics/text.js';
import { applyBaseline } from '../run/baseline.js';
import type { Thresholds } from '../suites/schema.js';
import type { CaseResult, ModelRun, Perf, RunReport } from './schema.js';

export interface Delta {
  older?: number;
  newer?: number;
  changePct?: number;
}

type CaseTransition = 'same' | 'fixed' | 'broken' | 'new' | 'removed';

export interface CaseComparison {
  model: string;
  id: string;
  older?: CaseResult;
  newer?: CaseResult;
  transition: CaseTransition;
  outputSimilarity?: number;
}

export interface ModelComparison {
  id: string;
  older?: ModelRun;
  newer?: ModelRun;
  loadMs: Delta;
  tokensPerSecond: Delta;
  ttftP50: Delta;
  latencyP50: Delta;
  latencyP95: Delta;
  peakRssMb: Delta;
}

export interface Comparison {
  older: RunReport;
  newer: RunReport;
  models: ModelComparison[];
  cases: CaseComparison[];
}

function delta(older: number | undefined, newer: number | undefined): Delta {
  return {
    ...(older !== undefined && { older }),
    ...(newer !== undefined && { newer }),
    ...(older !== undefined && newer !== undefined && { changePct: percentChange(older, newer) }),
  };
}

function compareModel(older: ModelRun | undefined, newer: ModelRun | undefined): ModelComparison {
  const before: Perf | undefined = older?.perf;
  const after: Perf | undefined = newer?.perf;
  const id = newer?.model.id ?? older?.model.id ?? '';
  return {
    id,
    ...(older !== undefined && { older }),
    ...(newer !== undefined && { newer }),
    loadMs: delta(before?.loadMs, after?.loadMs),
    tokensPerSecond: delta(before?.tokensPerSecond, after?.tokensPerSecond),
    ttftP50: delta(before?.ttftMs?.p50, after?.ttftMs?.p50),
    latencyP50: delta(before?.latencyMs?.p50, after?.latencyMs?.p50),
    latencyP95: delta(before?.latencyMs?.p95, after?.latencyMs?.p95),
    peakRssMb: delta(before?.peakRssMb, after?.peakRssMb),
  };
}

function transitionOf(
  older: CaseResult | undefined,
  newer: CaseResult | undefined,
): CaseTransition {
  if (older === undefined) return 'new';
  if (newer === undefined) return 'removed';
  const wasGood = older.status === 'passed';
  const isGood = newer.status === 'passed';
  if (wasGood && !isGood) return 'broken';
  if (!wasGood && isGood) return 'fixed';
  return 'same';
}

function compareCases(older: ModelRun | undefined, newer: ModelRun | undefined): CaseComparison[] {
  const model = newer?.model.id ?? older?.model.id ?? '';
  const ids = [
    ...new Set([...(newer?.cases ?? []), ...(older?.cases ?? [])].map((testCase) => testCase.id)),
  ];
  return ids.map((id) => {
    const before = older?.cases.find((testCase) => testCase.id === id);
    const after = newer?.cases.find((testCase) => testCase.id === id);
    const comparable =
      before?.output !== undefined && after?.output !== undefined && before.kind !== 'embed';
    return {
      model,
      id,
      ...(before !== undefined && { older: before }),
      ...(after !== undefined && { newer: after }),
      transition: transitionOf(before, after),
      ...(comparable && {
        outputSimilarity: normalizedSimilarity(before.output ?? '', after.output ?? ''),
      }),
    };
  });
}

export function compareReports(
  older: RunReport,
  newer: RunReport,
  limits: Thresholds,
  source?: string,
): Comparison {
  const annotated = applyBaseline(newer, older, limits, source);
  const ids = [...new Set([...annotated.models, ...older.models].map((run) => run.model.id))];
  const find = (report: RunReport, id: string) => report.models.find((run) => run.model.id === id);
  return {
    older,
    newer: annotated,
    models: ids.map((id) => compareModel(find(older, id), find(annotated, id))),
    cases: ids.flatMap((id) => compareCases(find(older, id), find(annotated, id))),
  };
}
