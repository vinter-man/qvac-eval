import { formatNumber } from '../format.js';
import type { GoldenEntry } from '../run/golden.js';
import type { Diff, Regression } from '../report/schema.js';
import { normalizedSimilarity } from './text.js';
import { cosineSimilarity } from './vector.js';

export interface GoldenComparison {
  regressions: Regression[];
  similarity?: number;
  diff?: Diff;
}

export function compareTextWithGolden(
  entry: GoldenEntry,
  text: string,
  minSimilarity: number,
  goldenSdk: string,
): GoldenComparison {
  if (entry.kind === 'embed') return { regressions: [] };
  const similarity = normalizedSimilarity(entry.text, text);
  if (similarity >= minSimilarity) return { regressions: [], similarity };
  return {
    similarity,
    diff: { expected: entry.text, actual: text },
    regressions: [
      {
        source: 'golden',
        metric: 'goldenSimilarity',
        message: `output is ${formatNumber(similarity, 3)} similar to the golden recorded with SDK ${goldenSdk}, below ${minSimilarity}`,
        baseline: minSimilarity,
        current: similarity,
      },
    ],
  };
}

export function compareVectorsWithGolden(
  entry: GoldenEntry,
  vectors: readonly (readonly number[])[],
  minCosine: number,
  goldenSdk: string,
): GoldenComparison {
  if (entry.kind !== 'embed') return { regressions: [] };

  const shapeOf = (list: readonly (readonly number[])[]) =>
    `${list.length} × ${list[0]?.length ?? 0}`;
  const sameShape =
    entry.vectors.length === vectors.length &&
    entry.vectors.every((vector, index) => vector.length === vectors[index]?.length);
  if (!sameShape) {
    return {
      similarity: 0,
      regressions: [
        {
          source: 'golden',
          metric: 'goldenSimilarity',
          message: `embedding shape changed from ${shapeOf(entry.vectors)} (golden, SDK ${goldenSdk}) to ${shapeOf(vectors)}`,
        },
      ],
    };
  }

  const similarity = Math.min(
    ...entry.vectors.map((golden, index) => cosineSimilarity(golden, vectors[index] ?? [])),
  );
  if (similarity >= minCosine) return { regressions: [], similarity };
  return {
    similarity,
    regressions: [
      {
        source: 'golden',
        metric: 'goldenSimilarity',
        message: `cosine to the golden vector recorded with SDK ${goldenSdk} is ${formatNumber(similarity, 4)}, below ${minCosine}`,
        baseline: minCosine,
        current: similarity,
      },
    ],
  };
}
