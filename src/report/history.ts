import { z } from 'zod';

import { formatSignedPercent } from '../format.js';
import { percentChange } from '../metrics/stats.js';
import type { Trend } from './html/chart.js';
import { verdictSchema, type RunReport } from './schema.js';

const entryModelSchema = z.strictObject({
  id: z.string(),
  tokensPerSecond: z.number().optional(),
  latencyP50Ms: z.number().optional(),
});

const historyEntrySchema = z.strictObject({
  id: z.string(),
  startedAt: z.iso.datetime(),
  suite: z.string(),
  sdk: z.string(),
  verdict: verdictSchema,
  counts: z.strictObject({
    total: z.int(),
    passed: z.int(),
    failed: z.int(),
    regressed: z.int(),
    errored: z.int(),
  }),
  models: z.array(entryModelSchema),
  page: z.string(),
  runUrl: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historySchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(historyEntrySchema),
});
export type History = z.infer<typeof historySchema>;

export function entryId(report: RunReport): string {
  const stamp = report.startedAt.replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z');
  return `${stamp}-${report.suite.name}-${report.environment.sdk.version}`;
}

export function entryFromReport(report: RunReport, sdkLabel: string): HistoryEntry {
  const id = entryId(report);
  const { summary } = report;
  return {
    id,
    startedAt: report.startedAt,
    suite: report.suite.name,
    sdk: sdkLabel,
    verdict: report.verdict,
    counts: {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      regressed: summary.regressed,
      errored: summary.errored,
    },
    models: report.models.flatMap((run) =>
      run.status === 'completed'
        ? [
            {
              id: run.model.id,
              ...(run.perf?.tokensPerSecond !== undefined && {
                tokensPerSecond: run.perf.tokensPerSecond,
              }),
              ...(run.perf?.latencyMs !== undefined && { latencyP50Ms: run.perf.latencyMs.p50 }),
            },
          ]
        : [],
    ),
    page: `runs/${id}.html`,
    ...(report.environment.ci?.runUrl !== undefined && { runUrl: report.environment.ci.runUrl }),
  };
}

export function addEntry(
  previous: History | undefined,
  entry: HistoryEntry,
  keep: number,
): { history: History; kept: HistoryEntry[] } {
  const others = (previous?.entries ?? []).filter((candidate) => candidate.id !== entry.id);
  const entries = [...others, entry]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(-keep);
  return {
    history: { schemaVersion: 1, entries },
    kept: entries.filter((candidate) => candidate !== entry),
  };
}

export function buildTrends(entries: readonly HistoryEntry[], suite: string): Trend[] {
  const inSuite = entries.filter((entry) => entry.suite === suite);
  const ids = [...new Set(inSuite.flatMap((entry) => entry.models.map((model) => model.id)))];
  return ids.flatMap((id) => {
    const values = inSuite.flatMap((entry) => {
      const rate = entry.models.find((model) => model.id === id)?.tokensPerSecond;
      return rate === undefined ? [] : [rate];
    });
    const latest = values.at(-1);
    if (latest === undefined) return [];
    const before = values.at(-2);
    return [
      {
        label: id,
        values,
        latest: `${Math.round(latest)} tok/s`,
        change:
          before === undefined ? undefined : formatSignedPercent(percentChange(before, latest)),
      },
    ];
  });
}
