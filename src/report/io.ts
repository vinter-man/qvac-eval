import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isNotFound, UsageError } from '../errors.js';
import { compareVersions } from '../run/golden.js';
import { runReportSchema, type RunReport } from './schema.js';
import { summarize, verdictFor } from './summary.js';

export async function readReport(file: string): Promise<RunReport> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const reason = isNotFound(error) ? 'file not found' : String(error);
    throw new UsageError(`Cannot read report ${file}: ${reason}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`Report ${file} is not valid JSON`, [String(error)]);
  }
  const result = runReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new UsageError(
      `${file} is not a qvac-eval report`,
      result.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

export async function writeFileEnsuringDir(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const DECIMALS = 10_000;

export async function writeReport(file: string, report: RunReport): Promise<void> {
  const text = JSON.stringify(
    report,
    (_key, value: unknown) =>
      typeof value === 'number' ? Math.round(value * DECIMALS) / DECIMALS : value,
    2,
  );
  await writeFileEnsuringDir(file, `${text}\n`);
}

async function jsonFilesIn(directory: string, depth: number): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
    else if (entry.isDirectory() && depth > 0 && !entry.name.startsWith('.')) {
      files.push(...(await jsonFilesIn(path, depth - 1)));
    }
  }
  return files;
}

export async function expandReportPaths(paths: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const path of paths) {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new UsageError(`Cannot read report ${path}: file not found`);
    }
    if (info.isDirectory()) files.push(...(await jsonFilesIn(path, 2)));
    else files.push(path);
  }
  return files.sort();
}

export async function loadReports(paths: readonly string[]): Promise<RunReport[]> {
  const files = await expandReportPaths(paths);
  if (files.length === 0) throw new UsageError('No report files found', [...paths]);
  return Promise.all(files.map((file) => readReport(file)));
}

function platformOf(report: RunReport): string {
  return `${report.environment.platform}-${report.environment.arch}`;
}

function mergeGroup(group: readonly RunReport[]): RunReport {
  const [first] = group;
  if (first === undefined) throw new Error('Cannot merge an empty group');
  const seen = new Map<string, number>();
  const models = group.flatMap((report) => report.models);
  for (const model of models) seen.set(model.model.id, (seen.get(model.model.id) ?? 0) + 1);
  const repeated = [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  if (repeated.length > 0) {
    throw new UsageError(
      'The same model appears in more than one report of the same SDK version',
      repeated,
    );
  }

  const startedAt = group.map((report) => report.startedAt).sort()[0] ?? first.startedAt;
  const finishedAt =
    group
      .map((report) => report.finishedAt)
      .sort()
      .at(-1) ?? first.finishedAt;
  const summary = summarize(models);
  return { ...first, startedAt, finishedAt, models, summary, verdict: verdictFor(models, summary) };
}

export function mergeReports(reports: readonly RunReport[]): RunReport[] {
  const platforms = [...new Set(reports.map((report) => platformOf(report)))];
  if (platforms.length > 1) {
    throw new UsageError(
      'The reports come from different platforms; merge one platform at a time',
      platforms,
    );
  }
  const suites = [...new Set(reports.map((report) => report.suite.name))];
  if (suites.length > 1) {
    throw new UsageError(
      'The reports belong to different suites; merge one suite at a time',
      suites,
    );
  }

  const bySdk = new Map<string, RunReport[]>();
  for (const report of reports) {
    const key = report.environment.sdk.version;
    bySdk.set(key, [...(bySdk.get(key) ?? []), report]);
  }
  return [...bySdk.entries()]
    .sort(([left], [right]) => compareVersions(left, right))
    .map(([, group]) => mergeGroup(group));
}

export function pickBaseline(
  candidates: readonly RunReport[],
  suite: string,
  sdkVersion: string,
  exclude?: (report: RunReport) => boolean,
): RunReport | undefined {
  const matching = candidates
    .filter((report) => report.suite.name === suite && !(exclude?.(report) ?? false))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  return matching.find((report) => report.environment.sdk.version === sdkVersion) ?? matching[0];
}
