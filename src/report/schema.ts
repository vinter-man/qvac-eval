import { z } from 'zod';

import { modelKindSchema } from '../suites/schema.js';

export const caseStatusSchema = z.enum(['passed', 'failed', 'regressed', 'errored']);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

const distributionSchema = z.strictObject({ p50: z.number(), p95: z.number() });

const checkSchema = z.strictObject({
  name: z.string(),
  passed: z.boolean(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  detail: z.string().optional(),
});
export type CheckResult = z.infer<typeof checkSchema>;

export const regressionSchema = z.strictObject({
  source: z.enum(['golden', 'baseline']),
  metric: z.string(),
  message: z.string(),
  baseline: z.number().optional(),
  current: z.number().optional(),
});
export type Regression = z.infer<typeof regressionSchema>;

const caseMetricsSchema = z.strictObject({
  latencyMs: z.number(),
  ttftMs: z.number().optional(),
  tokensPerSecond: z.number().optional(),
  generatedTokens: z.number().optional(),
  wer: z.number().optional(),
  cosine: z.number().optional(),
  goldenSimilarity: z.number().optional(),
  realTimeFactor: z.number().optional(),
});
export type CaseMetrics = z.infer<typeof caseMetricsSchema>;

const caseErrorSchema = z.strictObject({
  kind: z.enum(['timeout', 'sdk']),
  message: z.string(),
});

const diffSchema = z.strictObject({ expected: z.string(), actual: z.string() });
export type Diff = z.infer<typeof diffSchema>;

export const caseResultSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['completion', 'embed', 'transcribe']),
  description: z.string().optional(),
  status: caseStatusSchema,
  attempts: z.int().positive(),
  checks: z.array(checkSchema),
  regressions: z.array(regressionSchema),
  metrics: caseMetricsSchema.optional(),
  output: z.string().optional(),
  diff: diffSchema.optional(),
  error: caseErrorSchema.optional(),
});
export type CaseResult = z.infer<typeof caseResultSchema>;

export const perfSchema = z.strictObject({
  loadMs: z.number(),
  downloadMs: z.number().optional(),
  ttftMs: distributionSchema.optional(),
  tokensPerSecond: z.number().optional(),
  latencyMs: distributionSchema.optional(),
  peakRssMb: z.number().optional(),
});
export type Perf = z.infer<typeof perfSchema>;

export const modelRunSchema = z.strictObject({
  model: z.strictObject({
    id: z.string(),
    kind: modelKindSchema,
    source: z.string(),
    license: z.string().optional(),
    sizeMb: z.number().optional(),
  }),
  status: z.enum(['completed', 'skipped', 'infra-error']),
  note: z.string().optional(),
  backend: z.string().optional(),
  goldenSdk: z.string().optional(),
  perf: perfSchema.optional(),
  regressions: z.array(regressionSchema),
  cases: z.array(caseResultSchema),
});
export type ModelRun = z.infer<typeof modelRunSchema>;

const summarySchema = z.strictObject({
  total: z.int(),
  passed: z.int(),
  failed: z.int(),
  regressed: z.int(),
  errored: z.int(),
  modelRegressions: z.int(),
});
export type Summary = z.infer<typeof summarySchema>;

export const verdictSchema = z.enum(['pass', 'fail', 'error']);
export type Verdict = z.infer<typeof verdictSchema>;

export const runReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tool: z.strictObject({ name: z.literal('qvac-eval'), version: z.string() }),
  suite: z.strictObject({ name: z.string(), file: z.string() }),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  options: z.strictObject({
    repeat: z.int().positive(),
    device: z.enum(['cpu', 'gpu', 'auto']),
  }),
  environment: z.strictObject({
    sdk: z.strictObject({ name: z.string(), version: z.string() }),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
    cpu: z.string().optional(),
    cpuCount: z.int(),
    memoryMb: z.int(),
    ci: z
      .strictObject({
        provider: z.literal('github-actions'),
        runner: z.string().optional(),
        runUrl: z.string().optional(),
        ref: z.string().optional(),
        sha: z.string().optional(),
      })
      .optional(),
  }),
  baseline: z
    .strictObject({
      sdkVersion: z.string(),
      startedAt: z.iso.datetime(),
      source: z.string().optional(),
    })
    .optional(),
  models: z.array(modelRunSchema),
  summary: summarySchema,
  verdict: verdictSchema,
});
export type RunReport = z.infer<typeof runReportSchema>;
