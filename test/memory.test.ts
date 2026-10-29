import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProcessTreeSampler, treeRssKb, type ProcessRow } from '../src/run/memory.js';

const table: ProcessRow[] = [
  { pid: 1, ppid: 0, rssKb: 100 },
  { pid: 10, ppid: 1, rssKb: 2_000 },
  { pid: 11, ppid: 10, rssKb: 1_000_000 },
  { pid: 12, ppid: 10, rssKb: 500 },
  { pid: 13, ppid: 11, rssKb: 300 },
  { pid: 99, ppid: 1, rssKb: 777_777 },
];

describe('treeRssKb', () => {
  it('sums the process and all its descendants and nothing else', () => {
    expect(treeRssKb(table, 10)).toBe(2_000 + 1_000_000 + 500 + 300);
    expect(treeRssKb(table, 11)).toBe(1_000_300);
    expect(treeRssKb(table, 13)).toBe(300);
  });

  it('returns 0 for a process that is not in the table', () => {
    expect(treeRssKb(table, 4242)).toBe(0);
  });

  it('terminates on a cycle', () => {
    const cyclic: ProcessRow[] = [
      { pid: 2, ppid: 3, rssKb: 10 },
      { pid: 3, ppid: 2, rssKb: 20 },
    ];
    expect(treeRssKb(cyclic, 2)).toBe(30);
  });
});

describe('createProcessTreeSampler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the peak of the samples in megabytes', async () => {
    vi.useFakeTimers();
    const readings = [100_000, 300_000, 200_000];
    let index = 0;
    const sampler = createProcessTreeSampler({
      rootPid: 10,
      intervalMs: 50,
      readTable: () =>
        Promise.resolve([
          { pid: 10, ppid: 1, rssKb: readings[Math.min(index++, readings.length - 1)] ?? 0 },
        ]),
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(120);
    const peak = await sampler.stop();
    expect(peak).toBeCloseTo(300_000 / 1024, 6);
  });

  it('survives a failing process table and reports nothing', async () => {
    const sampler = createProcessTreeSampler({
      rootPid: 10,
      intervalMs: 50,
      readTable: () => Promise.reject(new Error('ps is not available')),
    });
    sampler.start();
    expect(await sampler.stop()).toBeUndefined();
  });

  it('takes a final sample when stopped so a short run is still measured', async () => {
    const sampler = createProcessTreeSampler({
      rootPid: 10,
      intervalMs: 10_000,
      readTable: () => Promise.resolve([{ pid: 10, ppid: 1, rssKb: 2048 }]),
    });
    sampler.start();
    expect(await sampler.stop()).toBe(2);
  });
});
