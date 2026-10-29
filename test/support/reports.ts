import type { CaseResult, ModelRun, Perf, RunReport } from '../../src/report/schema.js';
import { summarize, verdictFor } from '../../src/report/summary.js';

export function makeCase(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
    kind: 'completion',
    status: 'passed',
    attempts: 1,
    checks: [],
    regressions: [],
    metrics: { latencyMs: 50 },
    output: 'Paris',
    ...overrides,
  };
}

export function makeModel(
  id: string,
  cases: CaseResult[],
  perf: Partial<Perf> = {},
  overrides: Partial<ModelRun> = {},
): ModelRun {
  return {
    model: {
      id,
      kind: 'llm',
      source: id.toUpperCase().replace(/[^A-Z0-9]+/gu, '_'),
      license: 'Apache-2.0',
      sizeMb: 386,
    },
    status: 'completed',
    backend: 'cpu',
    perf: {
      loadMs: 2000,
      tokensPerSecond: 100,
      ttftMs: { p50: 100, p95: 120 },
      latencyMs: { p50: 400, p95: 600 },
      peakRssMb: 1200,
      ...perf,
    },
    regressions: [],
    cases,
    ...overrides,
  };
}

export function makeReport(
  models: ModelRun[],
  options: { sdk?: string; startedAt?: string; suite?: string; platform?: string } = {},
): RunReport {
  const summary = summarize(models);
  const startedAt = options.startedAt ?? '2026-10-29T12:00:00.000Z';
  return {
    schemaVersion: 1,
    tool: { name: 'qvac-eval', version: '0.1.0' },
    suite: { name: options.suite ?? 'smoke', file: 'cases/smoke.yaml' },
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    options: { repeat: 1, device: 'cpu' },
    environment: {
      sdk: { name: '@qvac/sdk', version: options.sdk ?? '0.22.0' },
      node: 'v22.17.0',
      platform: options.platform ?? 'linux',
      arch: 'x64',
      cpu: 'AMD EPYC 7763',
      cpuCount: 4,
      memoryMb: 16384,
    },
    models,
    summary,
    verdict: verdictFor(models, summary),
  };
}
