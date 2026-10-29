import { describe, expect, it } from 'vitest';

import {
  assertCompilableSchema,
  parseJsonOutput,
  validateAgainstSchema,
} from '../src/metrics/json-schema.js';
import { distribution, median, percentChange, percentile, sum } from '../src/metrics/stats.js';
import {
  editDistance,
  normalizedSimilarity,
  tokenizeWords,
  wordErrorRate,
} from '../src/metrics/text.js';
import { cosineSimilarity, dotProduct, euclideanNorm } from '../src/metrics/vector.js';

describe('editDistance', () => {
  it('matches known Levenshtein values', () => {
    expect(editDistance(Array.from('kitten'), Array.from('sitting'))).toBe(3);
    expect(editDistance(Array.from('flaw'), Array.from('lawn'))).toBe(2);
    expect(editDistance(Array.from('same'), Array.from('same'))).toBe(0);
  });

  it('handles empty sides', () => {
    expect(editDistance([], Array.from('abc'))).toBe(3);
    expect(editDistance(Array.from('abc'), [])).toBe(3);
    expect(editDistance([], [])).toBe(0);
  });

  it('works on words as well as characters', () => {
    expect(editDistance(['the', 'cat', 'sat'], ['the', 'bat', 'sat'])).toBe(1);
  });
});

describe('normalizedSimilarity', () => {
  it('is 1 for identical text and ignores whitespace differences', () => {
    expect(normalizedSimilarity('Paris', 'Paris')).toBe(1);
    expect(normalizedSimilarity('  The  capital\nis Paris ', 'The capital is Paris')).toBe(1);
  });

  it('is 1 for two empty strings and 0 for disjoint strings of equal length', () => {
    expect(normalizedSimilarity('', '')).toBe(1);
    expect(normalizedSimilarity('abc', 'xyz')).toBe(0);
  });

  it('scales with the number of edits', () => {
    expect(normalizedSimilarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 10);
  });

  it('counts an astral character as one symbol', () => {
    expect(normalizedSimilarity('a😀', 'a😃')).toBeCloseTo(0.5, 10);
  });
});

describe('wordErrorRate', () => {
  it('is 0 for the same words regardless of case and punctuation', () => {
    expect(
      wordErrorRate('Ask not what your country can do.', 'ask not what your country can do'),
    ).toBe(0);
  });

  it('counts substitutions, deletions and insertions over the reference length', () => {
    expect(wordErrorRate('the cat sat on the mat', 'the bat sat on mat')).toBeCloseTo(2 / 6, 10);
    expect(wordErrorRate('one two', 'one two three four')).toBe(1);
  });

  it('can exceed 1 when the hypothesis is much longer', () => {
    expect(wordErrorRate('hi', 'oh hi there my friend')).toBe(4);
  });

  it('handles an empty reference', () => {
    expect(wordErrorRate('', '')).toBe(0);
    expect(wordErrorRate('...', 'something')).toBe(1);
  });

  it('keeps apostrophes inside words and unifies the curly one', () => {
    expect(tokenizeWords("Don’t stop, 'believing'")).toEqual(["don't", 'stop', 'believing']);
  });

  it('treats hyphenated words as separate words', () => {
    expect(tokenizeWords('multi-hundred')).toEqual(['multi', 'hundred']);
  });
});

describe('vectors', () => {
  it('computes dot product and norm', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(euclideanNorm([3, 4])).toBe(5);
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
    expect(cosineSimilarity([2, 0], [5, 5])).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('rejects vectors of different length', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(RangeError);
  });
});

describe('stats', () => {
  it('computes nearest-rank percentiles', () => {
    const values = [15, 20, 35, 40, 50];
    expect(percentile(values, 50)).toBe(35);
    expect(percentile(values, 95)).toBe(50);
    expect(percentile(values, 0)).toBe(15);
    expect(percentile([], 50)).toBeUndefined();
  });

  it('does not reorder the input', () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });

  it('computes the median of odd and even counts', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeUndefined();
  });

  it('summarises a distribution', () => {
    expect(distribution([10, 20, 30, 40])).toEqual({ p50: 20, p95: 40 });
    expect(distribution([])).toBeUndefined();
  });

  it('sums and measures percent change', () => {
    expect(sum([1, 2, 3.5])).toBe(6.5);
    expect(percentChange(200, 170)).toBeCloseTo(-15, 10);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(0, 5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('json schema checks', () => {
  const schema = {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
    additionalProperties: false,
  };

  it('accepts a conforming value', () => {
    expect(validateAgainstSchema({ ok: true }, schema)).toEqual({ ok: true });
  });

  it('explains why a value does not conform', () => {
    expect(validateAgainstSchema({ ok: 'yes' }, schema)).toEqual({
      ok: false,
      message: 'ok: Invalid input: expected boolean, received string',
    });
    expect(validateAgainstSchema({}, schema)).toMatchObject({ ok: false });
  });

  it('rejects an uncompilable schema up front', () => {
    expect(assertCompilableSchema(schema)).toEqual({ ok: true });
    expect(assertCompilableSchema({ type: 'banana' })).toMatchObject({ ok: false });
  });

  it('parses plain and fenced JSON output', () => {
    expect(parseJsonOutput('{"ok": true}')).toEqual({ ok: true, value: { ok: true } });
    expect(parseJsonOutput('```json\n{"ok": true}\n```')).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(parseJsonOutput('Sure! {"ok": true}')).toMatchObject({ ok: false });
  });
});
