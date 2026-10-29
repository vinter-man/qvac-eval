function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value: number, digits = 2): string {
  return String(round(value, digits));
}

export function formatMs(milliseconds: number): string {
  if (milliseconds >= 10_000) return `${formatNumber(milliseconds / 1000, 1)} s`;
  if (milliseconds >= 1000) return `${formatNumber(milliseconds / 1000, 2)} s`;
  if (milliseconds >= 100) return `${Math.round(milliseconds)} ms`;
  return `${formatNumber(milliseconds, 1)} ms`;
}

export function formatRate(tokensPerSecond: number): string {
  return `${formatNumber(tokensPerSecond, tokensPerSecond >= 100 ? 0 : 1)} tok/s`;
}

export function formatMegabytes(megabytes: number): string {
  return megabytes >= 1024
    ? `${formatNumber(megabytes / 1024, 2)} GB`
    : `${Math.round(megabytes)} MB`;
}

export function formatSignedPercent(change: number): string {
  if (!Number.isFinite(change)) return change > 0 ? '+∞%' : '-∞%';
  const rounded = round(change, 1);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function quote(text: string, limit = 160): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return JSON.stringify(flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat);
}
