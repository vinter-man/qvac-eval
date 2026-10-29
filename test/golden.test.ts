import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { compareTextWithGolden, compareVectorsWithGolden } from '../src/metrics/golden.js';
import {
  compareVersions,
  findGolden,
  formatGolden,
  goldenFilePath,
  pickClosestVersion,
  saveGolden,
  type GoldenEntry,
  type GoldenFile,
} from '../src/run/golden.js';
import { makeWorkspace } from './support/workspace.js';

function file(sdk: string, cases: GoldenFile['cases']): GoldenFile {
  return {
    schemaVersion: 1,
    suite: 'smoke',
    model: 'tiny-llm',
    sdk,
    recordedAt: '2026-10-29T10:00:00.000Z',
    cases,
  };
}

describe('compareVersions', () => {
  it('orders versions numerically, not as text', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('0.22.0', '0.21.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('puts a prerelease before its release', () => {
    expect(compareVersions('0.22.0-dev.1', '0.22.0')).toBeLessThan(0);
    expect(compareVersions('0.22.0', '0.22.0-dev.1')).toBeGreaterThan(0);
  });
});

describe('pickClosestVersion', () => {
  const versions = ['0.20.1', '0.21.1', '0.22.0'];

  it('prefers the exact version', () => {
    expect(pickClosestVersion(versions, '0.21.1')).toBe('0.21.1');
  });

  it('falls back to the nearest older version', () => {
    expect(pickClosestVersion(versions, '0.21.9')).toBe('0.21.1');
    expect(pickClosestVersion(versions, '1.0.0')).toBe('0.22.0');
  });

  it('uses a newer version when nothing older is recorded', () => {
    expect(pickClosestVersion(versions, '0.19.0')).toBe('0.20.1');
    expect(pickClosestVersion([], '0.19.0')).toBeUndefined();
  });
});

describe('golden files', () => {
  it('round-trips and finds the closest recorded SDK version', async () => {
    const dir = await makeWorkspace({});
    await saveGolden(dir, file('0.21.1', { a: { kind: 'completion', text: 'old' } }));
    await saveGolden(dir, file('0.22.0', { a: { kind: 'completion', text: 'new' } }));

    expect((await findGolden(dir, 'tiny-llm', 'smoke', '0.22.0'))?.cases.a).toEqual({
      kind: 'completion',
      text: 'new',
    });
    expect((await findGolden(dir, 'tiny-llm', 'smoke', '0.21.5'))?.sdk).toBe('0.21.1');
    expect((await findGolden(dir, 'tiny-llm', 'smoke', '0.30.0'))?.sdk).toBe('0.22.0');
    expect(await findGolden(dir, 'tiny-llm', 'other-suite', '0.22.0')).toBeUndefined();
    expect(await findGolden(dir, 'unknown-model', 'smoke', '0.22.0')).toBeUndefined();
  });

  it('merges new cases into an existing file instead of dropping the rest', async () => {
    const dir = await makeWorkspace({});
    await saveGolden(
      dir,
      file('0.22.0', {
        a: { kind: 'completion', text: 'A' },
        b: { kind: 'completion', text: 'B' },
      }),
    );
    await saveGolden(dir, file('0.22.0', { b: { kind: 'completion', text: 'B2' } }));
    const stored = await findGolden(dir, 'tiny-llm', 'smoke', '0.22.0');
    expect(stored?.cases).toEqual({
      a: { kind: 'completion', text: 'A' },
      b: { kind: 'completion', text: 'B2' },
    });
  });

  it('writes number arrays on one line and keeps the file valid JSON', async () => {
    const dir = await makeWorkspace({});
    await saveGolden(
      dir,
      file('0.22.0', {
        e: {
          kind: 'embed',
          vectors: [
            [0.1, -0.2, 0.3],
            [0.4, 0.5, -0.6],
          ],
        },
      }),
    );
    const text = await readFile(goldenFilePath(dir, 'tiny-llm', '0.22.0', 'smoke'), 'utf8');
    expect(text).toContain('[0.1, -0.2, 0.3]');
    expect(JSON.parse(text)).toMatchObject({
      cases: {
        e: {
          vectors: [
            [0.1, -0.2, 0.3],
            [0.4, 0.5, -0.6],
          ],
        },
      },
    });
    expect(formatGolden(file('0.22.0', {}))).toMatch(/\n$/u);
  });

  it('rejects a corrupt golden file with a clear message', async () => {
    const dir = await makeWorkspace({ 'tiny-llm/0.22.0/smoke.json': '{ "schemaVersion": 2 }' });
    await expect(findGolden(dir, 'tiny-llm', 'smoke', '0.22.0')).rejects.toThrow(
      'does not match the expected format',
    );
    const broken = await makeWorkspace({ 'tiny-llm/0.22.0/smoke.json': 'not json' });
    await expect(findGolden(broken, 'tiny-llm', 'smoke', '0.22.0')).rejects.toThrow(
      'not valid JSON',
    );
  });

  it('ignores directories that are not versions', async () => {
    const dir = await makeWorkspace({ 'tiny-llm/notes/smoke.json': '{}' });
    expect(await findGolden(dir, 'tiny-llm', 'smoke', '0.22.0')).toBeUndefined();
  });
});

describe('compareTextWithGolden', () => {
  const golden: GoldenEntry = { kind: 'completion', text: 'The capital of France is Paris.' };

  it('accepts text within the tolerance and reports the similarity', () => {
    const near = compareTextWithGolden(golden, 'The capital of France is Paris!', 0.85, '0.22.0');
    expect(near.regressions).toEqual([]);
    expect(near.similarity).toBeGreaterThan(0.95);
  });

  it('reports a regression with the golden and the new text', () => {
    const far = compareTextWithGolden(golden, 'Lyon', 0.85, '0.22.0');
    expect(far.regressions).toHaveLength(1);
    expect(far.regressions[0]).toMatchObject({ source: 'golden', metric: 'goldenSimilarity' });
    expect(far.regressions[0]?.message).toContain('SDK 0.22.0');
    expect(far.diff).toEqual({ expected: 'The capital of France is Paris.', actual: 'Lyon' });
  });

  it('ignores a golden entry of another kind', () => {
    expect(compareTextWithGolden({ kind: 'embed', vectors: [[1]] }, 'x', 0.9, '0.22.0')).toEqual({
      regressions: [],
    });
  });
});

describe('compareVectorsWithGolden', () => {
  const golden: GoldenEntry = {
    kind: 'embed',
    vectors: [
      [1, 0],
      [0, 1],
    ],
  };

  it('uses the worst cosine among the vectors', () => {
    const same = compareVectorsWithGolden(
      golden,
      [
        [1, 0],
        [0, 1],
      ],
      0.98,
      '0.22.0',
    );
    expect(same).toEqual({ regressions: [], similarity: 1 });
    const drift = compareVectorsWithGolden(
      golden,
      [
        [1, 0],
        [1, 1],
      ],
      0.98,
      '0.22.0',
    );
    expect(drift.similarity).toBeCloseTo(Math.SQRT1_2, 6);
    expect(drift.regressions[0]?.message).toContain('below 0.98');
  });

  it('flags a changed shape instead of comparing', () => {
    const resized = compareVectorsWithGolden(
      golden,
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      0.98,
      '0.22.0',
    );
    expect(resized.regressions[0]?.message).toContain('shape changed from 2 × 2');
    const fewer = compareVectorsWithGolden(golden, [[1, 0]], 0.98, '0.22.0');
    expect(fewer.regressions[0]?.message).toContain('to 1 × 2');
  });
});
