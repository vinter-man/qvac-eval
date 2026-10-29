export interface Distribution {
  p50: number;
  p95: number;
}

export function percentile(values: readonly number[], rank: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(sorted.length, Math.max(1, Math.ceil((rank / 100) * sorted.length)));
  return sorted[position - 1];
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (sorted.length % 2 === 1 || lower === undefined) return upper;
  return upper === undefined ? undefined : (lower + upper) / 2;
}

export function distribution(values: readonly number[]): Distribution | undefined {
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  if (p50 === undefined || p95 === undefined) return undefined;
  return { p50, p95 };
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function percentChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((to - from) / from) * 100;
}
