import { formatMs, formatRate } from '../../format.js';
import type { CaseResult, CaseStatus } from '../schema.js';
import {
  caseNote,
  describeChange,
  formatSimilarity,
  formatUtc,
  type CaseRow,
  type ChartPoint,
  type PerfRow,
  type ReportView,
  type ViewCell,
} from '../view.js';
import type { FontAssets } from './assets.js';
import { barChart, PATTERN_FILL, type BarRow, type BarSeries, type Pattern } from './chart.js';
import { diffWords, type DiffSegment } from './diff.js';
import { html, join, raw, type Safe } from './escape.js';
import { countBadge, renderPage } from './page.js';

export interface HtmlOptions {
  fonts: FontAssets;
  toolVersion: string;
  generatedAt: string;
  links?: { history?: string; run?: string };
}

export function statusMark(status: CaseStatus): Safe {
  const frame = '<rect x=".6" y=".6" width="10.8" height="10.8"';
  const shapes: Record<CaseStatus, string> = {
    passed: `${frame} fill="currentColor" stroke="currentColor" stroke-width="1.2"/>`,
    regressed: `${frame} fill="${PATTERN_FILL.dense}" stroke="currentColor" stroke-width="1.2"/>`,
    failed: `${frame} fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.2"/>`,
    errored: `${frame} fill="${PATTERN_FILL.sparse}" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/>`,
  };
  return raw(
    `<svg class="mark" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${shapes[status]}</svg>`,
  );
}

function renderCell(cell: ViewCell): Safe {
  if (cell.was === undefined) return html`${cell.text}`;
  const change = describeChange(cell.changePct);
  const chip =
    change === undefined
      ? null
      : html`<span class="chg${cell.worse === true ? ' worse' : ''}">${change}</span>`;
  return html`${cell.text}<small><span>was ${cell.was}</span>${chip}</small>`;
}

function perfRowHtml(row: PerfRow): Safe {
  const name = html`<td class="model"><b>${row.id}</b><small>${row.subtitle}</small></td>`;
  if (row.status !== 'completed') {
    return html`<tr>${name}<td colspan="6">${row.note ?? row.status}</td></tr>`;
  }
  const cells = [row.load, row.ttft, row.tokens, row.p50, row.p95, row.rss];
  return html`<tr>${name}${cells.map((cell) => html`<td class="num">${renderCell(cell)}</td>`)}</tr>`;
}

function chartRows(
  points: readonly ChartPoint[],
  compared: boolean,
  format: (value: number) => string,
): BarRow[] {
  return points.flatMap((point) => {
    const rows: BarRow[] = [];
    const push = (series: number, value: number | undefined) => {
      if (value === undefined) return;
      rows.push({
        label: point.model,
        series,
        value,
        text: format(value),
        showLabel: rows.length === 0,
      });
    };
    if (compared) push(0, point.older);
    push(compared ? 1 : 0, point.newer);
    return rows;
  });
}

function seriesFor(view: ReportView): BarSeries[] {
  const newer: BarSeries = { label: `SDK ${view.newerSdk}`, pattern: 'solid' };
  if (!view.compared) return [newer];
  const older: BarSeries = { label: `SDK ${view.olderSdk ?? ''}`, pattern: 'dense' };
  return [older, newer];
}

function speedSection(view: ReportView): Safe {
  const series = seriesFor(view);
  const tokens =
    view.tokensChart.length === 0
      ? null
      : html`<p class="label mut">Generation speed, higher is better</p>
        ${barChart({
          ariaLabel: 'Tokens per second by model',
          series,
          rows: chartRows(view.tokensChart, view.compared, formatRate),
          unit: 'tok/s',
          formatTick: (value) => String(Math.round(value)),
        })}`;
  const latency =
    view.latencyChart.length === 0
      ? null
      : html`<p class="label mut">Median latency per case, lower is better</p>
        ${barChart({
          ariaLabel: 'Median latency by model',
          series,
          rows: chartRows(view.latencyChart, view.compared, formatMs),
          unit: '',
          formatTick: formatMs,
        })}`;

  return html`<section id="speed" aria-labelledby="h-speed">
    <h2 id="h-speed">Speed${countBadge(view.perf.length)}</h2>
    <p class="lede">Measured on ${view.platformLabel}. Load time excludes the download. Peak memory is the resident size of the whole process tree, worker included.</p>
    ${tokens}
    ${latency}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th class="num">Load</th>
            <th class="num">TTFT p50</th>
            <th class="num">Throughput</th>
            <th class="num">Latency p50</th>
            <th class="num">Latency p95</th>
            <th class="num">Peak memory</th>
          </tr>
        </thead>
        <tbody>${view.perf.map(perfRowHtml)}</tbody>
      </table>
    </div>
  </section>`;
}

function regressionsSection(view: ReportView): Safe {
  const items = view.regressions.map((regression) => {
    const place =
      regression.caseId === undefined
        ? html`${regression.model}`
        : html`${regression.model} / ${regression.caseId}`;
    return html`<li>
      <span class="where">${place}<small class="mut"> ${regression.metric}</small></span>
      <span>${regression.message}</span>
    </li>`;
  });
  const body =
    items.length === 0
      ? html`<p class="empty">${view.comparedAgainst}</p>`
      : html`<ul class="regs">${items}</ul>`;
  return html`<section id="regressions" aria-labelledby="h-regressions">
    <h2 id="h-regressions">Regressions${countBadge(items.length)}</h2>
    ${body}
  </section>`;
}

function diffHtml(segments: readonly DiffSegment[]): Safe {
  return join(
    segments.map((segment) => {
      if (segment.kind === 'removed') return html`<del>${segment.text}</del>`;
      if (segment.kind === 'added') return html`<ins>${segment.text}</ins>`;
      return segment.text;
    }),
  );
}

function checkList(result: CaseResult): Safe | null {
  if (result.checks.length === 0) return null;
  const items = result.checks.map((check) => {
    const comparison = [
      check.expected === undefined ? undefined : `expected ${check.expected}`,
      check.actual === undefined ? undefined : `got ${check.actual}`,
      check.detail,
    ]
      .filter((part) => part !== undefined)
      .join(' · ');
    return html`<li${raw(check.passed ? '' : ' class="fail"')}>
      <span class="status">${statusMark(check.passed ? 'passed' : 'failed')}${check.name}</span>
      <span${raw(check.passed ? ' class="mut"' : '')}>${comparison}</span>
    </li>`;
  });
  return html`<ul class="checks">${items}</ul>`;
}

function regressionList(result: CaseResult): Safe | null {
  if (result.regressions.length === 0) return null;
  const items = result.regressions.map(
    (regression) => html`<li class="fail">
      <span class="status">${statusMark('regressed')}${regression.metric}</span>
      <span>${regression.message}</span>
    </li>`,
  );
  return html`<ul class="checks">${items}</ul>`;
}

function outputBlock(result: CaseResult): Safe | null {
  if (result.diff !== undefined) {
    const words = diffWords(result.diff.expected, result.diff.actual);
    return html`<div class="diff">
      <div><p class="label mut">Expected</p><pre>${diffHtml(words.expected)}</pre></div>
      <div><p class="label mut">Actual</p><pre>${diffHtml(words.actual)}</pre></div>
    </div>`;
  }
  if (result.output === undefined) return null;
  return html`<div><p class="label mut">Output</p><pre>${result.output}</pre></div>`;
}

function caseBody(row: CaseRow): Safe {
  const { result } = row;
  const earlier =
    row.older === undefined
      ? null
      : html`<p class="mut">Earlier SDK: ${row.older.status}${row.outputSimilarity === undefined ? '' : `, ${formatSimilarity(row.outputSimilarity)}`}</p>`;
  return html`<div class="case-body">
    ${result.description === undefined ? null : html`<p class="mut">${result.description}</p>`}
    ${result.error === undefined ? null : html`<p><b>${result.error.kind}</b> · ${result.error.message}</p>`}
    ${checkList(result)}
    ${regressionList(result)}
    ${outputBlock(result)}
    ${earlier}
  </div>`;
}

function caseHtml(row: CaseRow): Safe {
  const { result, model } = row;
  const latency = result.metrics === undefined ? '' : formatMs(result.metrics.latencyMs);
  const moved = row.older !== undefined && row.older.status !== result.status;
  const before = row.older !== undefined && moved ? html`${statusMark(row.older.status)}→` : null;
  const open = result.status === 'passed' ? '' : ' open';
  return html`<details class="case" data-status="${result.status}" data-model="${model.id}"${raw(open)}>
    <summary>
      <span class="status">${before}${statusMark(result.status)}${result.status}</span>
      <span class="case-id">${result.id}</span>
      <span class="case-model mut">${model.id}</span>
      <span class="case-metric">${latency}</span>
      <span class="case-note mut">${caseNote(result)}</span>
    </summary>
    ${caseBody(row)}
  </details>`;
}

function filterButton(
  kind: 'status' | 'model',
  value: string,
  label: string,
  count: number,
  pressed: boolean,
): Safe {
  return html`<button class="btn" type="button" data-kind="${kind}" data-value="${value}" aria-pressed="${String(pressed)}">${label}${countBadge(count)}</button>`;
}

function casesSection(view: ReportView): Safe {
  const { summary } = view;
  const statusButtons = [
    filterButton('status', 'all', 'All', summary.total, true),
    filterButton('status', 'passed', 'Passed', summary.passed, false),
    filterButton('status', 'failed', 'Failed', summary.failed, false),
    filterButton('status', 'regressed', 'Regressed', summary.regressed, false),
    summary.errored > 0
      ? filterButton('status', 'errored', 'Errored', summary.errored, false)
      : null,
  ];
  const modelButtons =
    view.models.length > 1
      ? [
          filterButton('model', 'all', 'All models', summary.total, true),
          ...view.models.map((id) =>
            filterButton(
              'model',
              id,
              id,
              view.cases.filter((row) => row.model.id === id).length,
              false,
            ),
          ),
        ]
      : [];
  const rows =
    view.cases.length === 0 ? html`<p class="empty">No case ran.</p>` : view.cases.map(caseHtml);
  return html`<section id="cases" aria-labelledby="h-cases">
    <h2 id="h-cases">Cases${countBadge(summary.total)}</h2>
    <div class="filters" id="filters" role="group" aria-label="Filter cases" hidden>${statusButtons}${modelButtons}</div>
    <p class="filter-note" id="filter-note" aria-live="polite"></p>
    <div class="cases">${rows}</div>
  </section>`;
}

function environmentSection(view: ReportView): Safe {
  const facts = view.facts.map((fact) => html`<dt>${fact.label}</dt><dd>${fact.value}</dd>`);
  return html`<section id="environment" aria-labelledby="h-environment">
    <h2 id="h-environment">Environment</h2>
    <dl class="facts">${facts}</dl>
  </section>`;
}

function toneFill(tone: ReportView['verdict']['tone']): string {
  const pattern: Pattern = tone === 'pass' ? 'solid' : tone === 'fail' ? 'dense' : 'sparse';
  return PATTERN_FILL[pattern];
}

function heroSection(view: ReportView): Safe {
  const { summary, verdict } = view;
  const tally: [CaseStatus, number][] = [
    ['passed', summary.passed],
    ['failed', summary.failed],
    ['regressed', summary.regressed],
    ['errored', summary.errored],
  ];
  const items = tally.map(
    ([status, count]) => html`<li>${statusMark(status)}<b>${count}</b>${status}</li>`,
  );
  const bar = raw(
    `<svg class="tone" width="100%" height="10" aria-hidden="true" focusable="false"><rect width="100%" height="10" fill="${toneFill(verdict.tone)}"/><rect width="100%" height="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  );
  return html`<section class="hero" aria-labelledby="verdict">
    <p class="hero-meta label">${view.suite} · ${view.sdkLabel} · ${view.platformLabel}</p>
    <h1 class="hero-word" id="verdict">${verdict.word}</h1>
    ${bar}
    <p class="hero-sub">${verdict.sentence}</p>
    <ul class="tally">${items}</ul>
  </section>`;
}

export function renderHtml(view: ReportView, options: HtmlOptions): string {
  const links = options.links ?? {};
  const body = html`${heroSection(view)}
    <div class="layout">
      <nav class="selector" aria-label="Sections">
        <a href="#speed">Speed${countBadge(view.perf.length)}</a>
        <a href="#regressions">Regressions${countBadge(view.regressions.length)}</a>
        <a href="#cases">Cases${countBadge(view.summary.total)}</a>
        <a href="#environment">Environment</a>
      </nav>
      <div>
        ${speedSection(view)}
        ${regressionsSection(view)}
        ${casesSection(view)}
        ${environmentSection(view)}
      </div>
    </div>`;
  const footerRight =
    links.run === undefined
      ? html`<span class="mut label">qvac-eval ${options.toolVersion} · ${formatUtc(options.generatedAt)} · works offline</span>`
      : html`<a href="${links.run}">The run →</a>`;
  return renderPage({
    title: `qvac-eval · ${view.suite} · ${view.verdict.word} · ${view.sdkLabel}`,
    headerRight: view.sdkLabel,
    body,
    footerLeft: links.history === undefined ? null : html`<a href="${links.history}">← History</a>`,
    footerRight,
    fonts: options.fonts,
  });
}
