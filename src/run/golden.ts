import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { UsageError } from '../errors.js';

const goldenEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('completion'), text: z.string() }),
  z.strictObject({ kind: z.literal('embed'), vectors: z.array(z.array(z.number())) }),
  z.strictObject({ kind: z.literal('transcribe'), text: z.string() }),
]);
export type GoldenEntry = z.infer<typeof goldenEntrySchema>;

export const goldenFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  suite: z.string(),
  model: z.string(),
  sdk: z.string(),
  recordedAt: z.iso.datetime(),
  cases: z.record(z.string(), goldenEntrySchema),
});
export type GoldenFile = z.infer<typeof goldenFileSchema>;

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

export function compareVersions(left: string, right: string): number {
  const leftMatch = VERSION_PATTERN.exec(left);
  const rightMatch = VERSION_PATTERN.exec(right);
  if (leftMatch === null || rightMatch === null) return left.localeCompare(right);
  for (const position of [1, 2, 3]) {
    const difference = Number(leftMatch[position]) - Number(rightMatch[position]);
    if (difference !== 0) return difference;
  }
  const leftPre = leftMatch[4];
  const rightPre = rightMatch[4];
  if (leftPre === rightPre) return 0;
  if (leftPre === undefined) return 1;
  if (rightPre === undefined) return -1;
  return leftPre.localeCompare(rightPre);
}

const NUMBER_ARRAY = /\[\s*(-?\d[^[\]{}"]*?)\s*\]/gu;

export function formatGolden(file: GoldenFile): string {
  const pretty = JSON.stringify(file, null, 2);
  return `${pretty.replace(NUMBER_ARRAY, (_match, numbers: string) => `[${numbers.replace(/\s*\n\s*/gu, ' ')}]`)}\n`;
}

export function goldenFilePath(dir: string, modelId: string, sdk: string, suite: string): string {
  return join(dir, modelId, sdk, `${suite}.json`);
}

async function recordedVersions(dir: string, modelId: string, suite: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(join(dir, modelId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const versions: string[] = [];
  for (const entry of entries) {
    if (!VERSION_PATTERN.test(entry)) continue;
    try {
      await access(goldenFilePath(dir, modelId, entry, suite));
      versions.push(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return versions.sort(compareVersions);
}

export function pickClosestVersion(
  versions: readonly string[],
  wanted: string,
): string | undefined {
  if (versions.includes(wanted)) return wanted;
  const lower = versions.filter((version) => compareVersions(version, wanted) < 0);
  return lower.at(-1) ?? versions.find((version) => compareVersions(version, wanted) > 0);
}

async function readGolden(file: string): Promise<GoldenFile | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new UsageError(`Cannot read golden file ${file}`, [String(error)]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`Golden file ${file} is not valid JSON`, [String(error)]);
  }
  const result = goldenFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new UsageError(
      `Golden file ${file} does not match the expected format`,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

export async function findGolden(
  dir: string,
  modelId: string,
  suite: string,
  sdk: string,
): Promise<GoldenFile | undefined> {
  const version = pickClosestVersion(await recordedVersions(dir, modelId, suite), sdk);
  if (version === undefined) return undefined;
  return readGolden(goldenFilePath(dir, modelId, version, suite));
}

export async function saveGolden(
  dir: string,
  next: GoldenFile,
): Promise<{ file: string; written: number }> {
  const file = goldenFilePath(dir, next.model, next.sdk, next.suite);
  const existing = await readGolden(file);
  const merged: GoldenFile = { ...next, cases: { ...existing?.cases, ...next.cases } };
  await mkdir(join(dir, next.model, next.sdk), { recursive: true });
  await writeFile(file, formatGolden(merged));
  return { file, written: Object.keys(next.cases).length };
}
