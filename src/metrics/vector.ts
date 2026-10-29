export function dotProduct(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new RangeError(`Vectors differ in length: ${left.length} and ${right.length}`);
  }
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return sum;
}

export function euclideanNorm(vector: readonly number[]): number {
  return Math.sqrt(dotProduct(vector, vector));
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const denominator = euclideanNorm(left) * euclideanNorm(right);
  if (denominator === 0) return 0;
  return dotProduct(left, right) / denominator;
}
