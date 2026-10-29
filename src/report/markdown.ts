import { formatMs } from '../format.js';
import type { CaseRow, PerfRow, ReportView, ViewCell } from './view.js';
import { describeChange, formatSimilarity } from './view.js';

function escapeCell(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\s*\n\s*/gu, ' ');
}

function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${text}${fence}`;
}

function fenced(text: string): string[] {
  const longest = Math.max(2, ...(text.match(/`{3,}/gu) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return [fence, text, fence];
}

function cellText(value: ViewCell): string {
  if (value.was === undefined) return value.text;
  const change = describeChange(value.changePct);
  if (change === '±0%') return value.text;
  return `${value.text} (was ${value.was}${change === undefined ? '' : `, ${change}`})`;
}

function perfTable(rows: readonly PerfRow[]): string[] {
  const lines = [
    '| Model | Load | TTFT p50 | Throughput | Latency p50 | Latency p95 | Peak memory |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    if (row.status !== 'completed') {
      lines.push(`| ${code(row.id)} | ${escapeCell(row.note ?? row.status)} | | | | | |`);
      continue;
    }
    lines.push(
      `| ${code(row.id)} | ${[row.load, row.ttft, row.tokens, row.p50, row.p95, row.rss]
        .map((value) => escapeCell(cellText(value)))
        .join(' | ')} |`,
    );
  }
  return lines;
}

function statusWord(status: CaseRow['result']['status']): string {
  return status === 'passed' ? 'passed' : `**${status}**`;
}

function caseNote(row: CaseRow): string {
  const { result } = row;
  if (result.error !== undefined) return `${result.error.kind}: ${result.error.message}`;
  const failed = result.checks.find((check) => !check.passed);
  if (failed !== undefined)
    return `${failed.name}${failed.detail === undefined ? '' : `: ${failed.detail}`}`;
  const first = result.regressions[0];
  if (first !== undefined) return first.message;
  if (row.outputSimilarity !== undefined && row.outputSimilarity < 1)
    return formatSimilarity(row.outputSimilarity);
  return '';
}

function casesTable(rows: readonly CaseRow[]): string[] {
  const lines = ['| Model | Case | Result | Latency | Note |', '| --- | --- | --- | ---: | --- |'];
  for (const row of rows) {
    const latency = row.result.metrics === undefined ? '' : formatMs(row.result.metrics.latencyMs);
    lines.push(
      `| ${code(row.model.id)} | ${code(row.result.id)} | ${statusWord(row.result.status)} | ${latency} | ${escapeCell(caseNote(row))} |`,
    );
  }
  return lines;
}

function problemDetails(rows: readonly CaseRow[]): string[] {
  const problems = rows.filter((row) => row.result.status !== 'passed');
  if (problems.length === 0) return [];
  const lines = ['', '### Details of failures', ''];
  for (const row of problems) {
    const { result } = row;
    lines.push(
      `<details><summary>${code(row.model.id)} / ${code(result.id)} — ${result.status}</summary>`,
      '',
    );
    for (const check of result.checks.filter((entry) => !entry.passed)) {
      const parts = [
        check.expected === undefined ? undefined : `expected ${check.expected}`,
        check.actual === undefined ? undefined : `got ${check.actual}`,
        check.detail,
      ].filter((part) => part !== undefined);
      lines.push(`- ${code(check.name)}: ${parts.join('; ')}`);
    }
    for (const regression of result.regressions)
      lines.push(`- ${code(regression.metric)}: ${regression.message}`);
    if (result.error !== undefined) lines.push(`- ${result.error.kind}: ${result.error.message}`);
    if (result.diff !== undefined) {
      lines.push(
        '',
        'Expected',
        '',
        ...fenced(result.diff.expected),
        '',
        'Actual',
        '',
        ...fenced(result.diff.actual),
      );
    } else if (result.output !== undefined) {
      lines.push('', 'Output', '', ...fenced(result.output));
    }
    lines.push('', '</details>', '');
  }
  return lines;
}

export function renderMarkdown(view: ReportView): string {
  const { summary } = view;
  const lines = [
    `## qvac-eval · ${view.suite} — ${view.verdict.word}`,
    '',
    `${code(view.sdkLabel)} · ${view.platformLabel}`,
    '',
    view.verdict.sentence,
    '',
    `${summary.passed} passed · ${summary.failed} failed · ${summary.regressed} regressed · ${summary.errored} errored`,
    '',
    '### Speed',
    '',
    ...perfTable(view.perf),
  ];

  if (view.regressions.length > 0) {
    lines.push('', '### Regressions', '');
    for (const regression of view.regressions) {
      const place =
        regression.caseId === undefined
          ? code(regression.model)
          : `${code(regression.model)} / ${code(regression.caseId)}`;
      lines.push(`- ${place} · ${code(regression.metric)}: ${regression.message}`);
    }
  }

  lines.push('', '### Cases', '', ...casesTable(view.cases), ...problemDetails(view.cases));
  if (view.compared) {
    const comparable = view.cases.filter((row) => row.outputSimilarity !== undefined);
    const identical = comparable.filter((row) => row.outputSimilarity === 1).length;
    lines.push(
      '',
      `${identical} of ${comparable.length} text outputs are identical to the ones from SDK ${view.olderSdk ?? 'before'}.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
