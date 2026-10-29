import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RunnerSession } from '../src/adapter/types.js';
import type { CliDeps } from '../src/cli/deps.js';
import { main } from '../src/cli/main.js';
import { loadFontAssets } from '../src/report/html/assets.js';
import { renderHistory } from '../src/report/html/history.js';
import {
  addEntry,
  buildTrends,
  entryFromReport,
  entryId,
  type HistoryEntry,
} from '../src/report/history.js';
import { writeReport } from '../src/report/io.js';
import type { RunReport } from '../src/report/schema.js';
import { noMemory } from './support/fakes.js';
import { makeCase, makeModel, makeReport } from './support/reports.js';
import { makeWorkspace } from './support/workspace.js';

const root = resolve(import.meta.dirname, '..');

function entry(
  startedAt: string,
  rate: number | undefined,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry {
  const report = makeReport([makeModel('tiny-llm', [makeCase('a')], { tokensPerSecond: rate })], {
    startedAt,
  });
  const [model] = report.models;
  if (model !== undefined && rate === undefined) model.perf = { loadMs: 1 };
  return { ...entryFromReport(report, 'SDK 0.22.0'), ...extra };
}

describe('history entries', () => {
  it('summarises a report and links its page', () => {
    const report = makeReport(
      [
        makeModel('tiny-llm', [makeCase('a'), makeCase('b', { status: 'failed' })], {
          tokensPerSecond: 123.4,
          latencyMs: { p50: 40, p95: 90 },
        }),
        makeModel('broken', [], {}, { status: 'infra-error', note: 'x' }),
      ],
      { startedAt: '2026-10-29T12:00:05.123Z' },
    );
    const built = entryFromReport(
      {
        ...report,
        environment: {
          ...report.environment,
          ci: { provider: 'github-actions', runUrl: 'https://github.com/o/r/actions/runs/7' },
        },
      },
      'SDK 0.22.0',
    );
    expect(entryId(report)).toBe('20261029T120005Z-smoke-0.22.0');
    expect(built).toMatchObject({
      id: '20261029T120005Z-smoke-0.22.0',
      suite: 'smoke',
      sdk: 'SDK 0.22.0',
      verdict: 'error',
      counts: { total: 2, passed: 1, failed: 1 },
      models: [{ id: 'tiny-llm', tokensPerSecond: 123.4, latencyP50Ms: 40 }],
      page: 'runs/20261029T120005Z-smoke-0.22.0.html',
      runUrl: 'https://github.com/o/r/actions/runs/7',
    });
  });

  it('keeps the newest runs in time order and replaces a run that is added twice', () => {
    const first = addEntry(undefined, entry('2026-10-01T00:00:00.000Z', 100), 3);
    const second = addEntry(first.history, entry('2026-10-03T00:00:00.000Z', 90), 3);
    const third = addEntry(second.history, entry('2026-10-02T00:00:00.000Z', 95), 3);
    expect(third.history.entries.map((candidate) => candidate.startedAt.slice(0, 10))).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);

    const fourth = addEntry(third.history, entry('2026-10-04T00:00:00.000Z', 80), 3);
    expect(fourth.history.entries).toHaveLength(3);
    expect(fourth.history.entries[0]?.startedAt.slice(0, 10)).toBe('2026-10-02');
    expect(fourth.kept.map((candidate) => candidate.startedAt.slice(0, 10))).toEqual([
      '2026-10-02',
      '2026-10-03',
    ]);

    const again = addEntry(fourth.history, entry('2026-10-04T00:00:00.000Z', 70), 3);
    expect(again.history.entries).toHaveLength(3);
    expect(again.history.entries.at(-1)?.models[0]?.tokensPerSecond).toBe(70);
  });
});

describe('buildTrends', () => {
  it('follows a model through the runs of one suite and reports the last change', () => {
    const entries = [
      entry('2026-10-01T00:00:00.000Z', 100),
      entry('2026-10-02T00:00:00.000Z', undefined),
      entry('2026-10-03T00:00:00.000Z', 80),
      entry('2026-10-04T00:00:00.000Z', 50, { suite: 'other' }),
    ];
    expect(buildTrends(entries, 'smoke')).toEqual([
      { label: 'tiny-llm', values: [100, 80], latest: '80 tok/s', change: '-20%' },
    ]);
    expect(buildTrends(entries, 'other')).toEqual([
      { label: 'tiny-llm', values: [50], latest: '50 tok/s', change: undefined },
    ]);
    expect(buildTrends(entries, 'missing')).toEqual([]);
  });
});

describe('renderHistory', () => {
  async function page(entries: HistoryEntry[]) {
    return renderHistory(
      { schemaVersion: 1, entries },
      {
        fonts: await loadFontAssets(root),
        toolVersion: '0.1.0',
        generatedAt: '2026-10-29T12:00:00.000Z',
      },
    );
  }

  it('lists the newest run first and draws a trend line per model', async () => {
    const output = await page([
      entry('2026-10-01T00:00:00.000Z', 100),
      entry('2026-10-02T00:00:00.000Z', 80),
    ]);
    expect(output.indexOf('2026-10-02 00:00 UTC')).toBeLessThan(
      output.indexOf('2026-10-01 00:00 UTC'),
    );
    expect(output).toContain('<polyline');
    expect(output).toContain('80 tok/s');
    expect(output).toContain('<a href="index.html">← Latest run</a>');
    expect(output).not.toMatch(/(?:src|href)="https?:/u);
  });

  it('draws a single point as a line and survives an empty history', async () => {
    expect(await page([entry('2026-10-01T00:00:00.000Z', 100)])).toContain('class="trace"');
    const empty = await page([]);
    expect(empty).toContain('0 runs');
    expect(empty).not.toContain('Latest run');
  });

  it('escapes whatever came from the history file', async () => {
    const output = await page([
      entry('2026-10-01T00:00:00.000Z', 100, {
        suite: 'smoke',
        sdk: '<b>x</b>',
        runUrl: 'https://x.test/"><script>',
      }),
    ]);
    expect(output).not.toContain('<b>x</b>');
    expect(output).not.toContain('"><script>');
  });
});

describe('report --site', () => {
  async function harness() {
    const cwd = await makeWorkspace({});
    const stdout: string[] = [];
    const stderr: string[] = [];
    const deps: CliDeps = {
      cwd,
      env: {},
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
      now: () => new Date('2026-10-29T13:00:00.000Z'),
      packageRoot: root,
      signal: new AbortController().signal,
      createSampler: noMemory,
      npm: () => Promise.reject(new Error('npm is not available in tests')),
      openSession: (): Promise<RunnerSession> => Promise.reject(new Error('not used')),
    };
    const save = async (name: string, report: RunReport) =>
      writeReport(join(cwd, 'in', name), report);
    return { cwd, stderr, save, run: (...argv: string[]) => main(argv, deps) };
  }

  const at = (startedAt: string) =>
    makeReport([makeModel('tiny-llm', [makeCase('a')], { tokensPerSecond: 100 })], { startedAt });

  it('writes the latest run, a page for it and the history, and carries the old pages forward', async () => {
    const { cwd, save, run } = await harness();
    await save('one.json', at('2026-10-01T00:00:00.000Z'));
    await save('two.json', at('2026-10-02T00:00:00.000Z'));

    expect(await run('report', 'in/one.json', '--site', 'site1')).toBe(0);
    expect(await run('report', 'in/two.json', '--site', 'site2', '--previous', 'site1')).toBe(0);

    expect((await readdir(join(cwd, 'site2'))).sort()).toEqual([
      'history.html',
      'history.json',
      'index.html',
      'runs',
    ]);
    expect((await readdir(join(cwd, 'site2', 'runs'))).sort()).toEqual([
      '20261001T000000Z-smoke-0.22.0.html',
      '20261002T000000Z-smoke-0.22.0.html',
    ]);
    const index = await readFile(join(cwd, 'site2', 'index.html'), 'utf8');
    expect(index).toContain('<a href="history.html">← History</a>');
    const runPage = await readFile(
      join(cwd, 'site2', 'runs', '20261002T000000Z-smoke-0.22.0.html'),
      'utf8',
    );
    expect(runPage).toContain('<a href="../history.html">← History</a>');
    const history = JSON.parse(await readFile(join(cwd, 'site2', 'history.json'), 'utf8')) as {
      entries: unknown[];
    };
    expect(history.entries).toHaveLength(2);
  });

  it('forgets the runs beyond --keep, page included', async () => {
    const { cwd, save, run } = await harness();
    await save('one.json', at('2026-10-01T00:00:00.000Z'));
    await save('two.json', at('2026-10-02T00:00:00.000Z'));
    await run('report', 'in/one.json', '--site', 'site1');
    await run('report', 'in/two.json', '--site', 'site2', '--previous', 'site1', '--keep', '1');
    expect(await readdir(join(cwd, 'site2', 'runs'))).toEqual([
      '20261002T000000Z-smoke-0.22.0.html',
    ]);
    await expect(
      access(join(cwd, 'site2', 'runs', '20261001T000000Z-smoke-0.22.0.html')),
    ).rejects.toThrow();
  });

  it('starts afresh, with a warning, when the previous history cannot be read', async () => {
    const { cwd, save, run, stderr } = await harness();
    await save('one.json', at('2026-10-01T00:00:00.000Z'));
    const broken = await makeWorkspace({ 'history.json': '{"entries": 3}' });
    expect(await run('report', 'in/one.json', '--site', 'site', '--previous', broken)).toBe(0);
    expect(stderr.join('')).toContain('is unreadable; starting the history afresh');
    expect(await readdir(join(cwd, 'site', 'runs'))).toHaveLength(1);
  });

  it('works when there is no previous site at all', async () => {
    const { save, run } = await harness();
    await save('one.json', at('2026-10-01T00:00:00.000Z'));
    expect(
      await run('report', 'in/one.json', '--site', 'site', '--previous', 'does-not-exist'),
    ).toBe(0);
  });
});
