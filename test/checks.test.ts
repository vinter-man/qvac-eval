import { describe, expect, it } from 'vitest';

import { checkCompletion, checkEmbedding, checkTranscription } from '../src/metrics/checks.js';

const observation = (text: string, extra = {}) => ({ outputs: [text], latencyMs: 100, ...extra });
const failedNames = (checks: { name: string; passed: boolean }[]) =>
  checks.filter((check) => !check.passed).map((check) => check.name);

describe('checkCompletion', () => {
  it('matches exact text ignoring case and whitespace by default', () => {
    expect(
      checkCompletion({ exact: 'Paris' }, observation('  paris \n'), false).checks[0]?.passed,
    ).toBe(true);
    const strict = checkCompletion(
      { exact: 'Paris', caseSensitive: true },
      observation('paris'),
      false,
    );
    expect(strict.checks[0]?.passed).toBe(false);
    expect(strict.diff).toEqual({ expected: 'Paris', actual: 'paris' });
  });

  it('reports which substrings are missing', () => {
    const { checks } = checkCompletion(
      { contains: ['Paris', 'France'] },
      observation('Paris is nice'),
      false,
    );
    expect(checks[0]).toMatchObject({
      name: 'contains',
      passed: false,
      detail: 'missing "France"',
    });
  });

  it('fails when a forbidden substring is present', () => {
    const { checks } = checkCompletion(
      { notContains: ['sorry'] },
      observation("I'm Sorry, but"),
      false,
    );
    expect(checks[0]).toMatchObject({
      name: 'notContains',
      passed: false,
      detail: 'found "sorry"',
    });
    expect(
      checkCompletion({ notContains: ['sorry'] }, observation('fine'), false).checks[0]?.passed,
    ).toBe(true);
  });

  it('applies a regex with the case rule', () => {
    expect(checkCompletion({ regex: '^\\d+$' }, observation('42'), false).checks[0]?.passed).toBe(
      true,
    );
    expect(checkCompletion({ regex: 'paris' }, observation('Paris'), false).checks[0]?.passed).toBe(
      true,
    );
    expect(
      checkCompletion({ regex: 'paris', caseSensitive: true }, observation('Paris'), false)
        .checks[0]?.passed,
    ).toBe(false);
  });

  it('validates JSON against the schema and explains the failure', () => {
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    expect(
      checkCompletion({ jsonSchema: schema }, observation('{"ok": true}'), false).checks[0]?.passed,
    ).toBe(true);
    expect(
      checkCompletion({ jsonSchema: schema }, observation('```json\n{"ok": true}\n```'), false)
        .checks[0]?.passed,
    ).toBe(true);
    const wrongType = checkCompletion({ jsonSchema: schema }, observation('{"ok": "yes"}'), false)
      .checks[0];
    expect(wrongType).toMatchObject({ passed: false });
    expect(wrongType?.detail).toContain('ok:');
    const notJson = checkCompletion({ jsonSchema: schema }, observation('Sure! Here you go'), false)
      .checks[0];
    expect(notJson).toMatchObject({ passed: false });
    expect(notJson?.detail).toContain('not valid JSON');
  });

  it('compares repeated outputs when determinism is required', () => {
    const same = checkCompletion({}, { outputs: ['a', 'a', 'a'], latencyMs: 1 }, true).checks[0];
    expect(same).toMatchObject({ name: 'deterministic', passed: true });
    const drift = checkCompletion({}, { outputs: ['a', 'a', 'b'], latencyMs: 1 }, true).checks[0];
    expect(drift).toMatchObject({
      passed: false,
      actual: '1 of 2 repeats differ from the first run',
    });
    expect(checkCompletion({}, { outputs: ['a', 'b'], latencyMs: 1 }, false).checks).toEqual([]);
  });

  it('enforces latency, time to first token and throughput budgets', () => {
    const fast = { latencyMs: 100, ttftMs: 20, tokensPerSecond: 50 };
    const budgets = { maxLatencyMs: 200, maxTtftMs: 30, minTokensPerSecond: 40 };
    expect(failedNames(checkCompletion(budgets, observation('x', fast), false).checks)).toEqual([]);
    const slow = { latencyMs: 500, ttftMs: 90, tokensPerSecond: 10 };
    expect(failedNames(checkCompletion(budgets, observation('x', slow), false).checks)).toEqual([
      'maxLatencyMs',
      'maxTtftMs',
      'minTokensPerSecond',
    ]);
  });

  it('fails a budget that cannot be measured instead of passing silently', () => {
    const { checks } = checkCompletion(
      { maxTtftMs: 10, minTokensPerSecond: 5 },
      observation('x'),
      false,
    );
    expect(checks.map((check) => check.actual)).toEqual(['not reported', 'not reported']);
    expect(failedNames(checks)).toEqual(['maxTtftMs', 'minTokensPerSecond']);
  });
});

describe('checkEmbedding', () => {
  const unit = (values: number[]) => values;
  const vectors = [unit([1, 0, 0]), unit([0.8, 0.6, 0]), unit([0, 0, 1])];

  it('checks dimensions and normalisation', () => {
    expect(
      failedNames(checkEmbedding({ dims: 3, normalized: true }, { vectors, latencyMs: 1 }).checks),
    ).toEqual([]);
    const wrong = checkEmbedding({ dims: 768 }, { vectors, latencyMs: 1 }).checks[0];
    expect(wrong).toMatchObject({ passed: false, expected: '768', actual: '3' });
    const unnormalised = checkEmbedding(
      { normalized: true },
      { vectors: [[3, 4, 0]], latencyMs: 1 },
    ).checks[0];
    expect(unnormalised?.passed).toBe(false);
  });

  it('bounds the cosine of the first pair from both sides', () => {
    expect(
      failedNames(
        checkEmbedding({ cosineMin: 0.7, cosineMax: 0.9 }, { vectors, latencyMs: 1 }).checks,
      ),
    ).toEqual([]);
    expect(
      failedNames(checkEmbedding({ cosineMin: 0.9 }, { vectors, latencyMs: 1 }).checks),
    ).toEqual(['cosineMin']);
    expect(
      failedNames(checkEmbedding({ cosineMax: 0.5 }, { vectors, latencyMs: 1 }).checks),
    ).toEqual(['cosineMax']);
  });

  it('verifies the order of pair similarities', () => {
    const ok = checkEmbedding(
      { ranking: [{ closer: [0, 1], than: [0, 2] }] },
      { vectors, latencyMs: 1 },
    );
    expect(ok.checks[0]).toMatchObject({ passed: true, name: 'ranking [0,1] > [0,2]' });
    const reversed = checkEmbedding(
      { ranking: [{ closer: [0, 2], than: [0, 1] }] },
      { vectors, latencyMs: 1 },
    );
    expect(reversed.checks[0]?.passed).toBe(false);
  });

  it('enforces the latency budget', () => {
    expect(
      failedNames(checkEmbedding({ maxLatencyMs: 5 }, { vectors, latencyMs: 9 }).checks),
    ).toEqual(['maxLatencyMs']);
  });
});

describe('checkTranscription', () => {
  const reference = 'ask not what your country can do for you';

  it('passes within the word error budget and gives a diff beyond it', () => {
    const near = checkTranscription(
      { reference, werMax: 0.2 },
      { text: 'Ask not what your country can do for you.', latencyMs: 1 },
    );
    expect(near.checks[0]).toMatchObject({ name: 'werMax', passed: true });
    const far = checkTranscription(
      { reference, werMax: 0.2 },
      { text: 'ask what your county can do', latencyMs: 1 },
    );
    expect(far.checks[0]?.passed).toBe(false);
    expect(far.diff).toEqual({ expected: reference, actual: 'ask what your county can do' });
  });

  it('checks keywords and the real-time factor', () => {
    const result = checkTranscription(
      { contains: ['Country'], maxRealTimeFactor: 0.5, maxLatencyMs: 100 },
      { text: 'your country', latencyMs: 300, realTimeFactor: 0.9 },
    );
    expect(failedNames(result.checks)).toEqual(['maxLatencyMs', 'maxRealTimeFactor']);
    expect(result.checks[0]?.passed).toBe(true);
  });
});
