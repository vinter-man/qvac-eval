import { escapeHtml, html, join, raw, type Safe } from './escape.js';

export type Pattern = 'solid' | 'dense' | 'sparse';

export interface BarSeries {
  label: string;
  pattern: Pattern;
}

export interface BarRow {
  label: string;
  series: number;
  value: number;
  text: string;
  showLabel: boolean;
}

export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => fraction <= candidate) ?? 10;
  return step * magnitude;
}

export const PATTERN_FILL: Record<Pattern, string> = {
  solid: 'currentColor',
  dense: 'url(#hatch-dense)',
  sparse: 'url(#hatch-sparse)',
};

export function patternDefs(): Safe {
  return raw(
    '<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
      '<pattern id="hatch-dense" width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="3.5" fill="currentColor"/></pattern>' +
      '<pattern id="hatch-sparse" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="1.2" height="6" fill="currentColor"/></pattern>' +
      '</defs></svg>',
  );
}

export function swatch(pattern: Pattern): Safe {
  return raw(
    `<svg class="swatch" width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><rect x=".6" y=".6" width="12.8" height="8.8" fill="${PATTERN_FILL[pattern]}" stroke="currentColor" stroke-width="1.2"/></svg>`,
  );
}

export function legend(series: readonly BarSeries[]): Safe {
  const items = series.map(
    (entry) => html`<li>${swatch(entry.pattern)}<span>${entry.label}</span></li>`,
  );
  return html`<ul class="legend">${items}</ul>`;
}

function barSvg(row: BarRow, series: BarSeries | undefined, ceiling: number): Safe {
  const width = Math.max(0, Math.min(100, (row.value / ceiling) * 100));
  const grid = [25, 50, 75, 100]
    .map((tick) => `<line x1="${tick}%" x2="${tick}%" y1="0" y2="100%" class="grid"/>`)
    .join('');
  const fill = PATTERN_FILL[series?.pattern ?? 'solid'];
  const title = escapeHtml(`${row.label}: ${row.text}`);
  return raw(
    `<svg class="bar-svg" width="100%" height="16" aria-hidden="true" focusable="false">${grid}` +
      `<rect x="0.6" y="2.6" width="${width}%" height="10.8" fill="${fill}" stroke="currentColor" stroke-width="1.2"><title>${title}</title></rect></svg>`,
  );
}

function barRow(row: BarRow, series: BarSeries | undefined, ceiling: number): Safe {
  return html`<div class="bar-row">
    <span class="bar-label">${row.showLabel ? row.label : ''}</span>
    ${barSvg(row, series, ceiling)}
    <span class="bar-value">${row.text}</span>
  </div>`;
}

export function barChart(options: {
  ariaLabel: string;
  series: readonly BarSeries[];
  rows: readonly BarRow[];
  unit: string;
  formatTick: (value: number) => string;
}): Safe {
  const max = Math.max(0, ...options.rows.map((row) => row.value));
  const ceiling = niceCeiling(max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => html`<span>${options.formatTick(ceiling * fraction)}</span>`,
  );
  return html`<figure class="chart" role="img" aria-label="${options.ariaLabel}">
    ${options.series.length > 1 ? legend(options.series) : null}
    <div class="bars">
      ${options.rows.map((row) => barRow(row, options.series[row.series], ceiling))}
      <div class="bar-row axis-row">
        <span></span>
        <div class="axis">${join(ticks)}</div>
        <span class="bar-value">${options.unit}</span>
      </div>
    </div>
  </figure>`;
}

export interface Trend {
  label: string;
  values: readonly number[];
  latest: string;
  change: string | undefined;
}

function sparkline(values: readonly number[], ceiling: number): Safe {
  if (values.length === 0) return raw('');
  const height = (value: number) => 19 - (value / ceiling) * 17;
  const last = Math.max(1, values.length - 1);
  const trace =
    values.length === 1
      ? `<line x1="0" x2="100" y1="${height(values[0] ?? 0)}" y2="${height(values[0] ?? 0)}" class="trace" vector-effect="non-scaling-stroke"/>`
      : `<polyline points="${values.map((value, index) => `${(index / last) * 100},${height(value)}`).join(' ')}" class="trace" fill="none" vector-effect="non-scaling-stroke"/>`;
  return raw(
    '<svg class="spark" viewBox="0 0 100 20" preserveAspectRatio="none" width="100%" height="28" aria-hidden="true" focusable="false">' +
      '<line x1="0" x2="100" y1="19.5" y2="19.5" class="grid" vector-effect="non-scaling-stroke"/>' +
      `${trace}</svg>`,
  );
}

export function trendChart(trends: readonly Trend[], ariaLabel: string): Safe {
  const ceiling = niceCeiling(Math.max(0, ...trends.flatMap((trend) => trend.values)));
  const rows = trends.map(
    (trend) => html`<div class="trend-row">
      <span class="bar-label">${trend.label}</span>
      ${sparkline(trend.values, ceiling)}
      <span class="bar-value">${trend.latest}${trend.change === undefined ? null : html`<small class="mut"> ${trend.change}</small>`}</span>
    </div>`,
  );
  return html`<div class="trends" role="img" aria-label="${ariaLabel}">${rows}</div>`;
}
