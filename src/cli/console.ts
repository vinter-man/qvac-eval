import { styleText } from 'node:util';

import { formatMegabytes, formatMs, formatNumber, formatRate } from '../format.js';
import type { CaseResult, CaseStatus, ModelRun, RunReport } from '../report/schema.js';
import type { ProgressEvent } from '../run/execute.js';

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  good(text: string): string;
  bad(text: string): string;
  warn(text: string): string;
}

export function createStyle(enabled: boolean): Style {
  const wrap = (format: Parameters<typeof styleText>[0]) => (text: string) =>
    enabled ? styleText(format, text, { validateStream: false }) : text;
  return {
    bold: wrap('bold'),
    dim: wrap('dim'),
    good: wrap('green'),
    bad: wrap('red'),
    warn: wrap('yellow'),
  };
}

const GLYPH: Record<CaseStatus, string> = {
  passed: '✓',
  failed: '✕',
  regressed: '▲',
  errored: '!',
};

function paint(status: CaseStatus, text: string, style: Style): string {
  if (status === 'passed') return style.good(text);
  return status === 'regressed' ? style.warn(text) : style.bad(text);
}

function caseFigures(result: CaseResult): string[] {
  const { metrics } = result;
  if (metrics === undefined) return [];
  const figures = [formatMs(metrics.latencyMs)];
  if (metrics.ttftMs !== undefined) figures.push(`ttft ${formatMs(metrics.ttftMs)}`);
  if (metrics.tokensPerSecond !== undefined && (metrics.generatedTokens ?? 0) >= 16) {
    figures.push(formatRate(metrics.tokensPerSecond));
  }
  if (metrics.wer !== undefined) figures.push(`WER ${formatNumber(metrics.wer, 3)}`);
  if (metrics.cosine !== undefined) figures.push(`cos ${formatNumber(metrics.cosine, 3)}`);
  if (metrics.realTimeFactor !== undefined)
    figures.push(`RTF ${formatNumber(metrics.realTimeFactor, 3)}`);
  return figures;
}

export function formatCase(result: CaseResult, style: Style): string[] {
  const head = `  ${paint(result.status, GLYPH[result.status], style)} ${result.id.padEnd(22)} ${style.dim(caseFigures(result).join('  ·  '))}`;
  const lines = [head.trimEnd()];
  if (result.error !== undefined) {
    lines.push(`      ${style.bad(`${result.error.kind}: ${result.error.message}`)}`);
  }
  for (const check of result.checks.filter((entry) => !entry.passed)) {
    const comparison = [
      check.expected === undefined ? undefined : `expected ${check.expected}`,
      check.actual === undefined ? undefined : `got ${check.actual}`,
    ]
      .filter((part) => part !== undefined)
      .join(', ');
    const detail = check.detail === undefined ? '' : ` (${check.detail})`;
    lines.push(`      ${style.bad(`${check.name}: ${comparison}${detail}`)}`);
  }
  for (const regression of result.regressions) {
    lines.push(`      ${style.warn(`${regression.metric}: ${regression.message}`)}`);
  }
  return lines;
}

function modelTitle(run: ModelRun, style: Style): string {
  const facts = [
    run.model.kind,
    run.model.sizeMb === undefined ? undefined : formatMegabytes(run.model.sizeMb),
    run.model.license,
  ]
    .filter((fact) => fact !== undefined)
    .join(' · ');
  return `${style.bold(run.model.id)}  ${style.dim(facts)}`;
}

export function formatEvent(event: ProgressEvent, style: Style): string[] {
  switch (event.type) {
    case 'model-start':
      return [
        '',
        `${style.bold(event.model.id)}  ${style.dim(`${event.model.kind} · ${event.cases} cases`)}`,
      ];
    case 'model-loaded': {
      const download =
        event.stats.downloadMs === undefined
          ? ''
          : `  (downloaded in ${formatMs(event.stats.downloadMs)})`;
      return [`  ${style.dim(`loaded in ${formatMs(event.stats.loadMs)}${download}`)}`];
    }
    case 'case-done':
      return formatCase(event.result, style);
    case 'model-done':
      return event.run.status === 'completed'
        ? formatModelFooter(event.run, style)
        : formatModelProblem(event.run, style);
    case 'golden-saved': {
      const skipped =
        event.skipped.length > 0 ? `, skipped ${event.skipped.join(', ')} (checks failed)` : '';
      return [
        `  ${style.dim(`golden: ${event.written} case(s) written to ${event.file}${skipped}`)}`,
      ];
    }
  }
}

function formatModelFooter(run: ModelRun, style: Style): string[] {
  const { perf } = run;
  const figures: string[] = [];
  if (perf?.tokensPerSecond !== undefined) figures.push(formatRate(perf.tokensPerSecond));
  if (perf?.latencyMs !== undefined) {
    figures.push(`p50 ${formatMs(perf.latencyMs.p50)}`, `p95 ${formatMs(perf.latencyMs.p95)}`);
  }
  if (perf?.peakRssMb !== undefined) figures.push(`peak ${formatMegabytes(perf.peakRssMb)}`);
  const lines = figures.length > 0 ? [`  ${style.dim(figures.join('  ·  '))}`] : [];
  for (const regression of run.regressions) {
    lines.push(`  ${style.warn(`▲ ${regression.metric}: ${regression.message}`)}`);
  }
  if (run.note !== undefined) lines.push(`  ${style.warn(run.note)}`);
  return lines;
}

function formatModelProblem(run: ModelRun, style: Style): string[] {
  if (run.status === 'skipped') {
    return ['', modelTitle(run, style), `  ${style.dim(`skipped: ${run.note ?? ''}`)}`];
  }
  return [`  ${style.bad(`${run.model.id}: ${run.note ?? 'infrastructure error'}`)}`];
}

export function formatBaselineRegressions(report: RunReport, style: Style): string[] {
  const lines: string[] = [];
  for (const run of report.models) {
    for (const regression of run.regressions.filter((entry) => entry.source === 'baseline')) {
      lines.push(
        `  ${style.warn(`▲ ${run.model.id}  ${regression.metric}: ${regression.message}`)}`,
      );
    }
    for (const testCase of run.cases) {
      for (const regression of testCase.regressions.filter(
        (entry) => entry.source === 'baseline',
      )) {
        lines.push(
          `  ${style.warn(`▲ ${run.model.id} / ${testCase.id}  ${regression.metric}: ${regression.message}`)}`,
        );
      }
    }
  }
  return lines.length === 0 ? [] : ['', style.bold('Against the baseline'), ...lines];
}

export function formatSummary(report: RunReport, style: Style): string[] {
  const { summary } = report;
  const parts = [
    style.good(`${summary.passed} passed`),
    summary.failed > 0 ? style.bad(`${summary.failed} failed`) : `${summary.failed} failed`,
    summary.regressed > 0
      ? style.warn(`${summary.regressed} regressed`)
      : `${summary.regressed} regressed`,
    summary.errored > 0 ? style.bad(`${summary.errored} errored`) : `${summary.errored} errored`,
  ];
  const lines = ['', `${style.bold('Result')}  ${parts.join(', ')} of ${summary.total} cases`];
  if (summary.modelRegressions > 0) {
    lines.push(
      `        ${style.warn(`${summary.modelRegressions} performance regression(s) against the baseline`)}`,
    );
  }
  if (report.verdict === 'error') {
    lines.push(`        ${style.bad('infrastructure error: the verdict cannot be trusted')}`);
  }
  return lines;
}
