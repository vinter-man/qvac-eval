import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

export interface MemorySampler {
  start(): void;
  stop(): Promise<number | undefined>;
}

export type MemorySamplerFactory = () => MemorySampler;

export async function readProcessTable(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss='], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const [pid, ppid, rssKb] = line.trim().split(/\s+/u).map(Number);
    if (pid === undefined || ppid === undefined || rssKb === undefined) continue;
    if (Number.isNaN(pid) || Number.isNaN(ppid) || Number.isNaN(rssKb)) continue;
    rows.push({ pid, ppid, rssKb });
  }
  return rows;
}

export function treeRssKb(rows: readonly ProcessRow[], rootPid: number): number {
  const childrenOf = new Map<number, ProcessRow[]>();
  const byPid = new Map<number, ProcessRow>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    childrenOf.set(row.ppid, [...(childrenOf.get(row.ppid) ?? []), row]);
  }

  let total = 0;
  const visited = new Set<number>();
  const queue = [rootPid];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    if (visited.has(pid)) continue;
    visited.add(pid);
    total += byPid.get(pid)?.rssKb ?? 0;
    queue.push(...(childrenOf.get(pid) ?? []).map((child) => child.pid));
  }
  return total;
}

export interface SamplerOptions {
  rootPid: number;
  intervalMs: number;
  readTable: () => Promise<ProcessRow[]>;
}

export function createProcessTreeSampler(options: SamplerOptions): MemorySampler {
  let peakKb: number | undefined;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  const sample = async (): Promise<void> => {
    try {
      const kilobytes = treeRssKb(await options.readTable(), options.rootPid);
      peakKb = Math.max(peakKb ?? 0, kilobytes);
    } catch {
      return;
    }
  };

  const tick = () => {
    inFlight ??= sample().finally(() => {
      inFlight = undefined;
    });
  };

  return {
    start() {
      tick();
      timer = setInterval(tick, options.intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer !== undefined) clearInterval(timer);
      await inFlight;
      await sample();
      return peakKb === undefined ? undefined : peakKb / 1024;
    },
  };
}

export function createDefaultSamplerFactory(): MemorySamplerFactory {
  return () => {
    if (process.platform === 'win32') {
      return { start: () => undefined, stop: () => Promise.resolve(undefined) };
    }
    return createProcessTreeSampler({
      rootPid: process.pid,
      intervalMs: 200,
      readTable: readProcessTable,
    });
  };
}
