import { buildTrends, type History, type HistoryEntry } from '../history.js';
import { formatUtc } from '../view.js';
import type { FontAssets } from './assets.js';
import { trendChart } from './chart.js';
import { html, type Safe } from './escape.js';
import { countBadge, renderPage } from './page.js';
import { statusMark } from './render.js';

export interface HistoryOptions {
  fonts: FontAssets;
  toolVersion: string;
  generatedAt: string;
}

const WORD: Record<HistoryEntry['verdict'], string> = {
  pass: 'Passed',
  fail: 'Failed',
  error: 'Error',
};

function verdictMark(entry: HistoryEntry): Safe {
  if (entry.verdict === 'pass') return statusMark('passed');
  if (entry.verdict === 'error') return statusMark('errored');
  return statusMark(entry.counts.failed + entry.counts.errored > 0 ? 'failed' : 'regressed');
}

function runRow(entry: HistoryEntry): Safe {
  const { counts } = entry;
  return html`<tr>
    <td><a href="${entry.page}">${formatUtc(entry.startedAt)}</a></td>
    <td>${entry.suite}</td>
    <td>${entry.sdk}</td>
    <td><span class="status">${verdictMark(entry)}${WORD[entry.verdict]}</span></td>
    <td class="num">${counts.passed} / ${counts.total}</td>
    <td>${entry.runUrl === undefined ? null : html`<a href="${entry.runUrl}">run</a>`}</td>
  </tr>`;
}

function trendSections(history: History): Safe[] {
  const suites = [...new Set(history.entries.map((entry) => entry.suite))];
  return suites.flatMap((suite) => {
    const trends = buildTrends(history.entries, suite);
    if (trends.length === 0) return [];
    return [
      html`<section aria-labelledby="h-trend-${suite}">
        <h2 id="h-trend-${suite}">Generation speed over runs<sup>${suite}</sup></h2>
        <p class="lede">Tokens per second of the suite "${suite}", oldest run on the left. Each line has its own scale, so a slope is a change.</p>
        ${trendChart(trends, `Tokens per second over runs, ${suite}`)}
      </section>`,
    ];
  });
}

export function renderHistory(history: History, options: HistoryOptions): string {
  const newest = [...history.entries].reverse();
  const latest = newest[0];
  const body = html`<section class="hero">
      <p class="hero-meta label">${history.entries.length} runs${latest === undefined ? '' : ` · latest ${formatUtc(latest.startedAt)}`}</p>
      <h1 class="hero-word">History</h1>
    </section>
    <div class="layout">
      <nav class="selector" aria-label="Sections">
        <a href="#trends">Trends</a>
        <a href="#runs">Runs${countBadge(newest.length)}</a>
      </nav>
      <div>
        <div id="trends">${trendSections(history)}</div>
        <section id="runs" aria-labelledby="h-runs">
          <h2 id="h-runs">Runs${countBadge(newest.length)}</h2>
          <div class="scroll">
            <table>
              <thead>
                <tr><th>Started</th><th>Suite</th><th>SDK</th><th>Result</th><th class="num">Passed</th><th></th></tr>
              </thead>
              <tbody>${newest.map(runRow)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>`;
  return renderPage({
    title: 'qvac-eval · History',
    headerRight: 'History',
    body,
    footerLeft: latest === undefined ? null : html`<a href="index.html">← Latest run</a>`,
    footerRight: html`<span class="mut label">qvac-eval ${options.toolVersion} · ${formatUtc(options.generatedAt)}</span>`,
    fonts: options.fonts,
  });
}
