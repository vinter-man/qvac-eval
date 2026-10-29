import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { UsageError } from '../errors.js';
import { expandReportPaths, pickBaseline, readReport } from '../report/io.js';
import type { RunReport } from '../report/schema.js';

export interface ResolvedBaseline {
  report: RunReport;
  source: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readLenient(paths: readonly string[]): Promise<RunReport[]> {
  const reports: RunReport[] = [];
  for (const file of await expandReportPaths(paths)) {
    try {
      reports.push(await readReport(file));
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
    }
  }
  return reports;
}

export async function assertBaselineExists(spec: string, cwd: string): Promise<void> {
  if (spec !== 'latest' && !(await exists(resolve(cwd, spec)))) {
    throw new UsageError(`Baseline not found: ${spec}`);
  }
}

export async function resolveBaseline(
  spec: string,
  options: { cwd: string; outDir: string; suite: string; sdkVersion: string },
): Promise<ResolvedBaseline | undefined> {
  if (spec === 'latest') {
    if (!(await exists(options.outDir))) return undefined;
    const report = pickBaseline(
      await readLenient([options.outDir]),
      options.suite,
      options.sdkVersion,
    );
    return report === undefined ? undefined : { report, source: options.outDir };
  }

  await assertBaselineExists(spec, options.cwd);
  const path = resolve(options.cwd, spec);
  const info = await stat(path);
  if (info.isFile()) return { report: await readReport(path), source: spec };

  const report = pickBaseline(await readLenient([path]), options.suite, options.sdkVersion);
  return report === undefined ? undefined : { report, source: spec };
}
