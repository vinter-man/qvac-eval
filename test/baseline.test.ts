import { describe, expect, it } from 'vitest';

import { applyBaseline, perfRegressions } from '../src/run/baseline.js';
import { thresholdsSchema } from '../src/suites/schema.js';
import { makeCase, makeModel, makeReport } from './support/reports.js';

const limits = thresholdsSchema.parse({});
const base = {
  loadMs: 2000,
  tokensPerSecond: 100,
  ttftMs: { p50: 100, p95: 120 },
  latencyMs: { p50: 400, p95: 600 },
  peakRssMb: 1200,
};

describe('perfRegressions', () => {
  it('flags a throughput drop beyond the limit and names both numbers', () => {
    const found = perfRegressions(base, { ...base, tokensPerSecond: 80 }, limits);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: 'baseline',
      metric: 'tokensPerSecond',
      baseline: 100,
      current: 80,
    });
    expect(found[0]?.message).toBe('tokens/s fell -20% (100 tok/s → 80 tok/s, limit -15%)');
  });

  it('allows a drop inside the limit and ignores improvements', () => {
    expect(perfRegressions(base, { ...base, tokensPerSecond: 90 }, limits)).toEqual([]);
    expect(perfRegressions(base, { ...base, tokensPerSecond: 500 }, limits)).toEqual([]);
  });

  it('ignores relative changes that are tiny in absolute terms', () => {
    const quick = {
      ...base,
      tokensPerSecond: 3,
      ttftMs: { p50: 5, p95: 6 },
      latencyMs: { p50: 20, p95: 30 },
      loadMs: 100,
      peakRssMb: 20,
    };
    const slower = {
      ...quick,
      tokensPerSecond: 2.5,
      ttftMs: { p50: 15, p95: 16 },
      latencyMs: { p50: 40, p95: 80 },
      loadMs: 400,
      peakRssMb: 60,
    };
    expect(perfRegressions(quick, slower, limits)).toEqual([]);
  });

  it('flags time to first token, p95 latency, load time and memory growth', () => {
    const worse = {
      loadMs: 6000,
      tokensPerSecond: 100,
      ttftMs: { p50: 300, p95: 400 },
      latencyMs: { p50: 500, p95: 1200 },
      peakRssMb: 2000,
    };
    expect(perfRegressions(base, worse, limits).map((regression) => regression.metric)).toEqual([
      'ttftP50',
      'latencyP95',
      'loadMs',
      'peakRssMb',
    ]);
  });

  it('skips metrics that are missing on either side', () => {
    expect(perfRegressions({ loadMs: 100 }, { loadMs: 100, tokensPerSecond: 1 }, limits)).toEqual(
      [],
    );
  });

  it('honours custom thresholds', () => {
    const strict = thresholdsSchema.parse({ tokensPerSecondDropPct: 5 });
    expect(perfRegressions(base, { ...base, tokensPerSecond: 90 }, strict)).toHaveLength(1);
  });
});

describe('applyBaseline', () => {
  const baseline = makeReport(
    [
      makeModel('tiny-llm', [
        makeCase('capital'),
        makeCase('speech', { kind: 'transcribe', metrics: { latencyMs: 90, wer: 0.05 } }),
        makeCase('pair', {
          kind: 'embed',
          metrics: { latencyMs: 9, cosine: 0.97, goldenSimilarity: 0.999 },
        }),
        makeCase('stable'),
      ]),
    ],
    { sdk: '0.21.1', startedAt: '2026-10-20T12:00:00.000Z' },
  );

  it('marks a previously passing case that now fails as a baseline regression', () => {
    const current = makeReport([
      makeModel('tiny-llm', [makeCase('capital', { status: 'failed' })]),
    ]);
    const compared = applyBaseline(current, baseline, limits, 'baseline/');
    const result = compared.models[0]?.cases[0];
    expect(result?.status).toBe('failed');
    expect(result?.regressions).toEqual([
      { source: 'baseline', metric: 'status', message: 'passed in the baseline, now failed' },
    ]);
    expect(compared.baseline).toEqual({
      sdkVersion: '0.21.1',
      startedAt: '2026-10-20T12:00:00.000Z',
      source: 'baseline/',
    });
    expect(compared.verdict).toBe('fail');
  });

  it('turns a passing case into regressed when WER, cosine or golden similarity worsen', () => {
    const current = makeReport([
      makeModel('tiny-llm', [
        makeCase('speech', { kind: 'transcribe', metrics: { latencyMs: 90, wer: 0.2 } }),
        makeCase('pair', {
          kind: 'embed',
          metrics: { latencyMs: 9, cosine: 0.9, goldenSimilarity: 0.8 },
        }),
        makeCase('stable'),
      ]),
    ]);
    const compared = applyBaseline(current, baseline, limits);
    const [speech, pair, stable] = compared.models[0]?.cases ?? [];
    expect(speech).toMatchObject({ status: 'regressed' });
    expect(speech?.regressions[0]?.message).toBe('WER rose from 0.05 to 0.2 (limit +0.05)');
    expect(pair?.status).toBe('regressed');
    expect(pair?.regressions.map((regression) => regression.metric)).toEqual([
      'cosine',
      'goldenSimilarity',
    ]);
    expect(stable?.status).toBe('passed');
    expect(compared.summary).toMatchObject({ passed: 1, regressed: 2 });
  });

  it('adds performance regressions to the model and fails the verdict', () => {
    const current = makeReport([
      makeModel('tiny-llm', [makeCase('capital')], { tokensPerSecond: 50 }),
    ]);
    const compared = applyBaseline(current, baseline, limits);
    expect(compared.models[0]?.regressions[0]).toMatchObject({ metric: 'tokensPerSecond' });
    expect(compared.summary.modelRegressions).toBe(1);
    expect(compared.verdict).toBe('fail');
  });

  it('leaves models and cases that the baseline does not know alone', () => {
    const current = makeReport([
      makeModel('new-model', [makeCase('capital', { status: 'failed' })], { tokensPerSecond: 1 }),
      makeModel('tiny-llm', [makeCase('brand-new', { metrics: { latencyMs: 1 } })]),
    ]);
    const compared = applyBaseline(current, baseline, limits);
    expect(compared.models[0]?.regressions).toEqual([]);
    expect(compared.models[0]?.cases[0]?.regressions).toEqual([]);
    expect(compared.models[1]?.cases[0]?.status).toBe('passed');
  });

  it('does not compare against a baseline model that never completed', () => {
    const broken = makeReport([
      makeModel('tiny-llm', [], {}, { status: 'infra-error', note: 'download failed' }),
    ]);
    const current = makeReport([
      makeModel('tiny-llm', [makeCase('capital')], { tokensPerSecond: 1 }),
    ]);
    expect(applyBaseline(current, broken, limits).verdict).toBe('pass');
  });

  it('is idempotent and replaces the comparison when applied against another baseline', () => {
    const current = makeReport([
      makeModel('tiny-llm', [makeCase('capital', { status: 'failed' })], { tokensPerSecond: 50 }),
    ]);
    const once = applyBaseline(current, baseline, limits);
    const twice = applyBaseline(once, baseline, limits);
    expect(twice).toEqual(once);

    const forgiving = makeReport([
      makeModel('tiny-llm', [makeCase('capital', { status: 'failed' })], { tokensPerSecond: 50 }),
    ]);
    const replaced = applyBaseline(once, forgiving, limits);
    expect(replaced.models[0]?.regressions).toEqual([]);
    expect(replaced.models[0]?.cases[0]?.regressions).toEqual([]);
  });

  it('reverts a case to passed when its only regression came from an earlier baseline', () => {
    const current = makeReport([
      makeModel('tiny-llm', [
        makeCase('speech', { kind: 'transcribe', metrics: { latencyMs: 90, wer: 0.3 } }),
      ]),
    ]);
    const regressed = applyBaseline(current, baseline, limits);
    expect(regressed.models[0]?.cases[0]?.status).toBe('regressed');
    const mild = makeReport([
      makeModel('tiny-llm', [
        makeCase('speech', { kind: 'transcribe', metrics: { latencyMs: 90, wer: 0.28 } }),
      ]),
    ]);
    const cleared = applyBaseline(regressed, mild, limits);
    expect(cleared.models[0]?.cases[0]?.status).toBe('passed');
  });

  it('keeps golden regressions when the baseline comparison is recomputed', () => {
    const golden = { source: 'golden' as const, metric: 'goldenSimilarity', message: 'drifted' };
    const current = makeReport([
      makeModel('tiny-llm', [makeCase('capital', { status: 'regressed', regressions: [golden] })]),
    ]);
    const compared = applyBaseline(current, baseline, limits);
    expect(compared.models[0]?.cases[0]).toMatchObject({
      status: 'regressed',
      regressions: [golden],
    });
  });
});
