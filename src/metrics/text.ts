export function editDistance<T>(left: readonly T[], right: readonly T[]): number {
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1);
      const deletion = (previous[column] ?? 0) + 1;
      const insertion = (current[column - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

export function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

export function normalizedSimilarity(left: string, right: string): number {
  const leftSymbols = Array.from(collapseWhitespace(left));
  const rightSymbols = Array.from(collapseWhitespace(right));
  const longest = Math.max(leftSymbols.length, rightSymbols.length);
  if (longest === 0) return 1;
  return 1 - editDistance(leftSymbols, rightSymbols) / longest;
}

export function tokenizeWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/u)
    .map((word) => word.replace(/^'+|'+$/gu, ''))
    .filter((word) => word.length > 0);
}

export function wordErrorRate(reference: string, hypothesis: string): number {
  const expected = tokenizeWords(reference);
  const actual = tokenizeWords(hypothesis);
  if (expected.length === 0) return actual.length === 0 ? 0 : 1;
  return editDistance(expected, actual) / expected.length;
}
