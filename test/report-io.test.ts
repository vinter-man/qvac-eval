import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../src/errors.js';
import {
  loadReports,
  mergeReports,
  pickBaseline,
  readReport,
  writeReport,
} from '../src/report/io.js';
import { makeCase, makeModel, makeReport } from './support/reports.js';
import { makeWorkspace } from './support/workspace.js';

describe('report files', () => {
  it('round-trips a report and rounds long floats', async () => {
    const root = await makeWorkspace({});
    const report = makeReport([
      makeModel('tiny-llm', [makeCase('capital', { metrics: { latencyMs: 12.345678901234 } })]),
    ]);
    await writeReport(join(root, 'out', 'r.json'), report);
    const loaded = await readReport(join(root, 'out', 'r.json'));
    expect(loaded.models[0]?.cases[0]?.metrics?.latencyMs).toBe(12.3457);
  });

  it('rejects a file that is not a report and says what is wrong', async () => {
    const root = await makeWorkspace({ 'a.json': '{"hello": 1}', 'b.json': 'nope' });
    await expect(readReport(join(root, 'a.json'))).rejects.toThrow('is not a qvac-eval report');
    await expect(readReport(join(root, 'b.json'))).rejects.toThrow('is not valid JSON');
    await expect(readReport(join(root, 'missing.json'))).rejects.toThrow('file not found');
  });

  it('loads every report in a directory tree, as downloaded artifacts are laid out', async () => {
    const root = await makeWorkspace({});
    await writeReport(
      join(root, 'report-a', 'a.json'),
      makeReport([makeModel('a', [makeCase('x')])]),
    );
    await writeReport(
      join(root, 'report-b', 'b.json'),
      makeReport([makeModel('b', [makeCase('x')])]),
    );
    const reports = await loadReports([root]);
    expect(reports.map((report) => report.models[0]?.model.id)).toEqual(['a', 'b']);
    await expect(loadReports([join(root, 'report-a', 'nothing')])).rejects.toThrow(UsageError);
  });
});

describe('mergeReports', () => {
  it('merges the reports of one SDK version and keeps versions apart, oldest first', () => {
    const merged = mergeReports([
      makeReport([makeModel('b', [makeCase('x', { status: 'failed' })])], {
        sdk: '0.22.0',
        startedAt: '2026-10-29T12:05:00.000Z',
      }),
      makeReport([makeModel('a', [makeCase('x')])], {
        sdk: '0.22.0',
        startedAt: '2026-10-29T12:00:00.000Z',
      }),
      makeReport([makeModel('a', [makeCase('x')])], { sdk: '0.21.1' }),
    ]);
    expect(merged.map((report) => report.environment.sdk.version)).toEqual(['0.21.1', '0.22.0']);
    const latest = merged[1];
    expect(latest?.models.map((model) => model.model.id)).toEqual(['b', 'a']);
    expect(latest?.startedAt).toBe('2026-10-29T12:00:00.000Z');
    expect(latest?.finishedAt).toBe('2026-10-29T12:06:00.000Z');
    expect(latest?.summary).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(latest?.verdict).toBe('fail');
  });

  it('refuses to merge the same model twice, other platforms or other suites', () => {
    const a = makeReport([makeModel('a', [makeCase('x')])]);
    expect(() => mergeReports([a, a])).toThrow('same model appears in more than one report');
    expect(() =>
      mergeReports([a, makeReport([makeModel('b', [])], { platform: 'darwin' })]),
    ).toThrow('different platforms');
    expect(() => mergeReports([a, makeReport([makeModel('b', [])], { suite: 'other' })])).toThrow(
      'different suites',
    );
  });
});

describe('pickBaseline', () => {
  const old = makeReport([], { sdk: '0.21.1', startedAt: '2026-10-01T00:00:00.000Z' });
  const sameSdkOld = makeReport([], { sdk: '0.22.0', startedAt: '2026-10-05T00:00:00.000Z' });
  const sameSdkNew = makeReport([], { sdk: '0.22.0', startedAt: '2026-10-10T00:00:00.000Z' });
  const otherSuite = makeReport([], {
    sdk: '0.22.0',
    startedAt: '2026-10-20T00:00:00.000Z',
    suite: 'hard',
  });

  it('prefers the newest report of the same SDK version for the same suite', () => {
    expect(pickBaseline([old, sameSdkOld, sameSdkNew, otherSuite], 'smoke', '0.22.0')).toBe(
      sameSdkNew,
    );
  });

  it('falls back to the newest report of another SDK version', () => {
    expect(pickBaseline([old, sameSdkOld], 'smoke', '0.23.0')).toBe(sameSdkOld);
  });

  it('returns nothing when no report fits and can exclude a report', () => {
    expect(pickBaseline([otherSuite], 'smoke', '0.22.0')).toBeUndefined();
    expect(
      pickBaseline([sameSdkOld, sameSdkNew], 'smoke', '0.22.0', (report) => report === sameSdkNew),
    ).toBe(sameSdkOld);
  });
});
