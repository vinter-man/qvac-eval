import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareReports } from '../src/report/compare.js';
import { loadFontAssets } from '../src/report/html/assets.js';
import { niceCeiling } from '../src/report/html/chart.js';
import { diffWords } from '../src/report/html/diff.js';
import { escapeHtml, html, join, raw } from '../src/report/html/escape.js';
import { renderHtml } from '../src/report/html/render.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { buildView } from '../src/report/view.js';
import { thresholdsSchema } from '../src/suites/schema.js';
import { makeCase, makeModel, makeReport } from './support/reports.js';

const limits = thresholdsSchema.parse({});
const root = resolve(import.meta.dirname, '..');

describe('html escaping', () => {
  it('escapes everything interpolated and trusts only Safe values', () => {
    const hostile = '<img src=x onerror="alert(1)">&\'';
    expect(html`<p>${hostile}</p>`.value).toBe(
      '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;</p>',
    );
    expect(html`<p>${raw('<b>ok</b>')}</p>`.value).toBe('<p><b>ok</b></p>');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('renders numbers and lists and skips falsy values', () => {
    expect(html`${1}${false}${null}${undefined}${['<', raw('<i>')]}`.value).toBe('1&lt;<i>');
    expect(join(['a', 'b'], '-').value).toBe('a-b');
  });
});

describe('diffWords', () => {
  it('marks nothing when the texts are the same', () => {
    const diff = diffWords('the cat sat', 'the cat sat');
    expect(diff.expected).toEqual([{ kind: 'same', text: 'the cat sat' }]);
    expect(diff.actual).toEqual([{ kind: 'same', text: 'the cat sat' }]);
  });

  it('marks the replaced word on both sides and keeps the whitespace', () => {
    const diff = diffWords('ask not what your country', 'ask not what you country');
    expect(diff.expected).toEqual([
      { kind: 'same', text: 'ask not what ' },
      { kind: 'removed', text: 'your' },
      { kind: 'same', text: ' country' },
    ]);
    expect(diff.actual).toEqual([
      { kind: 'same', text: 'ask not what ' },
      { kind: 'added', text: 'you' },
      { kind: 'same', text: ' country' },
    ]);
  });

  it('handles insertions, deletions and empty input', () => {
    expect(diffWords('a b', 'a x b').actual.map((segment) => segment.kind)).toEqual([
      'same',
      'added',
      'same',
    ]);
    expect(diffWords('a x b', 'a b').expected.map((segment) => segment.kind)).toEqual([
      'same',
      'removed',
      'same',
    ]);
    expect(diffWords('', 'new')).toEqual({
      expected: [],
      actual: [{ kind: 'added', text: 'new' }],
    });
  });
});

describe('niceCeiling', () => {
  it('rounds up to a round number', () => {
    expect(niceCeiling(278)).toBe(500);
    expect(niceCeiling(240)).toBe(250);
    expect(niceCeiling(114)).toBe(200);
    expect(niceCeiling(0.8)).toBe(1);
    expect(niceCeiling(100)).toBe(100);
    expect(niceCeiling(0)).toBe(1);
  });
});

describe('compareReports', () => {
  const older = makeReport(
    [
      makeModel(
        'tiny-llm',
        [
          makeCase('a', { output: 'Paris is the capital' }),
          makeCase('b', { status: 'failed' }),
          makeCase('gone'),
        ],
        { tokensPerSecond: 100 },
      ),
    ],
    { sdk: '0.21.1', startedAt: '2026-10-20T00:00:00.000Z' },
  );
  const newer = makeReport(
    [
      makeModel(
        'tiny-llm',
        [makeCase('a', { output: 'Paris is the capital city' }), makeCase('b'), makeCase('fresh')],
        { tokensPerSecond: 70 },
      ),
    ],
    { sdk: '0.22.0' },
  );

  it('lists what changed between the versions', () => {
    const comparison = compareReports(older, newer, limits);
    const byId = Object.fromEntries(comparison.cases.map((entry) => [entry.id, entry]));
    expect(byId.a?.transition).toBe('same');
    expect(byId.a?.outputSimilarity).toBeCloseTo(1 - 5 / 25, 6);
    expect(byId.b?.transition).toBe('fixed');
    expect(byId.gone?.transition).toBe('removed');
    expect(byId.fresh?.transition).toBe('new');
    expect(comparison.models[0]?.tokensPerSecond).toEqual({
      older: 100,
      newer: 70,
      changePct: -30,
    });
    expect(comparison.newer.verdict).toBe('fail');
    expect(comparison.newer.baseline?.sdkVersion).toBe('0.21.1');
  });

  it('flags a case that used to pass', () => {
    const broken = makeReport([makeModel('tiny-llm', [makeCase('a', { status: 'failed' })])], {
      sdk: '0.22.0',
    });
    const comparison = compareReports(older, broken, limits);
    expect(comparison.cases.find((entry) => entry.id === 'a')?.transition).toBe('broken');
  });
});

describe('buildView', () => {
  it('words the verdict for each outcome', () => {
    const word = (cases: ReturnType<typeof makeCase>[], extra = {}) =>
      buildView(makeReport([makeModel('m', cases, {}, extra)])).verdict.word;
    expect(word([makeCase('a')])).toBe('Passed');
    expect(word([makeCase('a', { status: 'failed' })])).toBe('Failed');
    expect(word([makeCase('a', { status: 'regressed' })])).toBe('Regressed');
    expect(word([makeCase('a', { status: 'errored' })])).toBe('Failed');
    expect(word([], { status: 'infra-error', note: 'x' })).toBe('Error');
  });

  it('labels a comparison and ignores tiny absolute changes when judging "worse"', () => {
    const older = makeReport(
      [makeModel('m', [makeCase('a')], { ttftMs: { p50: 10, p95: 12 }, tokensPerSecond: 100 })],
      { sdk: '0.21.1' },
    );
    const newer = makeReport(
      [makeModel('m', [makeCase('a')], { ttftMs: { p50: 16, p95: 18 }, tokensPerSecond: 70 })],
      { sdk: '0.22.0' },
    );
    const view = buildView(newer, compareReports(older, newer, limits));
    expect(view.sdkLabel).toBe('SDK 0.21.1 → 0.22.0');
    expect(view.perf[0]?.ttft).toMatchObject({ text: '16 ms', was: '10 ms', worse: false });
    expect(view.perf[0]?.tokens).toMatchObject({ text: '70 tok/s', was: '100 tok/s', worse: true });
    expect(view.tokensChart).toEqual([{ model: 'm', older: 100, newer: 70 }]);
  });

  it('collects regressions of models and cases with their place', () => {
    const regression = { source: 'baseline' as const, metric: 'wer', message: 'WER rose' };
    const report = makeReport([
      makeModel(
        'm',
        [makeCase('a', { status: 'regressed', regressions: [regression] })],
        {},
        { regressions: [{ ...regression, metric: 'tokensPerSecond' }] },
      ),
    ]);
    expect(buildView(report).regressions.map((row) => [row.model, row.caseId, row.metric])).toEqual(
      [
        ['m', undefined, 'tokensPerSecond'],
        ['m', 'a', 'wer'],
      ],
    );
  });
});

describe('renderMarkdown', () => {
  it('summarises speed and cases and escapes table separators', () => {
    const report = makeReport([
      makeModel('tiny-llm', [
        makeCase('capital'),
        makeCase('bad', {
          status: 'failed',
          checks: [{ name: 'exact', passed: false, expected: '"a|b"', actual: '"c"' }],
          diff: { expected: 'a|b', actual: 'c' },
        }),
      ]),
    ]);
    const markdown = renderMarkdown(buildView(report));
    expect(markdown).toContain('## qvac-eval · smoke — Failed');
    expect(markdown).toContain(
      '| `tiny-llm` | 2 s | 100 ms | 100 tok/s | 400 ms | 600 ms | 1.17 GB |',
    );
    expect(markdown).toContain('| `tiny-llm` | `bad` | **failed** | 50 ms | `exact` |');
    expect(markdown).toContain('<details><summary>`tiny-llm` / `bad` — failed</summary>');
    expect(markdown).toContain('- `exact`: expected `"a|b"`; got `"c"`');
  });

  it('survives output that contains code fences', () => {
    const report = makeReport([
      makeModel('m', [
        makeCase('a', { status: 'failed', diff: { expected: 'x', actual: '```js\ncode\n```' } }),
      ]),
    ]);
    const markdown = renderMarkdown(buildView(report));
    expect(markdown).toContain('````\n```js\ncode\n```\n````');
  });

  it('reports how many text outputs stayed identical between SDK versions', () => {
    const older = makeReport(
      [makeModel('m', [makeCase('a', { output: 'same' }), makeCase('b', { output: 'one' })])],
      { sdk: '0.21.1' },
    );
    const newer = makeReport(
      [makeModel('m', [makeCase('a', { output: 'same' }), makeCase('b', { output: 'two' })])],
      { sdk: '0.22.0' },
    );
    const markdown = renderMarkdown(buildView(newer, compareReports(older, newer, limits)));
    expect(markdown).toContain('1 of 2 text outputs are identical to the ones from SDK 0.21.1.');
    expect(markdown).not.toContain('±0%');
    expect(markdown).toContain('| `m` | 2 s | 100 ms | 100 tok/s |');
  });

  it('keeps hostile model output inside code spans and fences', () => {
    const hostile =
      '</details>\n# pwned ![x](https://evil.example/t.png) [phish](https://evil.example/login) <img src=x onerror=alert(1)> @some-team';
    const report = makeReport([
      makeModel(
        'm',
        [
          makeCase('bad', {
            status: 'failed',
            output: hostile,
            checks: [
              {
                name: 'contains',
                passed: false,
                expected: hostile,
                actual: hostile,
                detail: hostile,
              },
            ],
            diff: { expected: hostile, actual: hostile },
            error: { kind: 'sdk', message: hostile },
            regressions: [{ source: 'baseline', metric: 'wer', message: hostile }],
          }),
        ],
        {},
        { note: hostile },
      ),
    ]);
    const markdown = renderMarkdown(buildView(report));
    const outsideCode = markdown
      .replace(/^(`{3,})[\s\S]*?^\1$/gmu, '')
      .replace(/(`+)(?:(?!\1)[^\n])+?\1/gu, '');
    expect(outsideCode).not.toMatch(/evil\.example|<img|# pwned|@some-team/u);
    expect(outsideCode.split('</details>').length - 1).toBe(1);
  });

  it('keeps a multi-line SDK error and a backtick-edged message inside their code spans', () => {
    const message = '`edge\n\n</details>\n\n# pwned ![x](https://evil.example/t.png)`';
    const report = makeReport([
      makeModel('m', [
        makeCase('bad', {
          status: 'errored',
          error: { kind: 'sdk', message },
          checks: [{ name: 'jsonSchema', passed: false, detail: message }],
        }),
      ]),
    ]);
    const markdown = renderMarkdown(buildView(report));
    const outsideCode = markdown
      .replace(/^(`{3,})[\s\S]*?^\1$/gmu, '')
      .replace(/(`+)(?:(?!\1)[^\n])+?\1/gu, '');
    expect(outsideCode).not.toMatch(/evil\.example|# pwned/u);
    expect(outsideCode.split('</details>').length - 1).toBe(1);
    expect(markdown).toContain('`` `edge </details> # pwned ![x](https://evil.example/t.png)` ``');
  });

  it('writes a visible placeholder for an empty message instead of empty backticks', () => {
    const report = makeReport([
      makeModel('m', [makeCase('bad', { status: 'errored', error: { kind: 'sdk', message: '' } })]),
    ]);
    expect(renderMarkdown(buildView(report))).toContain('- sdk: (empty)');
  });

  it('names the incomplete side when the older report is what makes a comparison an error', () => {
    const older = makeReport(
      [makeModel('m', [], {}, { status: 'infra-error', note: 'download failed' })],
      { sdk: '0.21.1' },
    );
    const newer = makeReport([makeModel('m', [makeCase('a')])], { sdk: '0.22.0' });
    const view = buildView(newer, compareReports(older, newer, limits));
    expect(view.verdict).toEqual({
      word: 'Error',
      tone: 'error',
      sentence:
        '1 of 1 cases passed on 1 model. The report of SDK 0.21.1 is incomplete (m), so the comparison is too.',
    });
  });

  it('names both sides when the newer and the older report are incomplete', () => {
    const older = makeReport([makeModel('a', [], {}, { status: 'infra-error', note: 'x' })], {
      sdk: '0.21.1',
    });
    const newer = makeReport([makeModel('b', [], {}, { status: 'infra-error', note: 'y' })], {
      sdk: '0.22.0',
    });
    const view = buildView(newer, compareReports(older, newer, limits));
    expect(view.verdict.sentence).toBe(
      '0 of 0 cases passed on 0 models. A model did not finish, so this result is incomplete. The report of SDK 0.21.1 is incomplete (a), so the comparison is too.',
    );
  });

  it('shows a model that could not run instead of empty numbers', () => {
    const report = makeReport([
      makeModel(
        'm',
        [],
        {},
        { status: 'infra-error', note: 'download failed | 503', perf: undefined },
      ),
    ]);
    expect(renderMarkdown(buildView(report))).toContain(
      '| `m` | `download failed \\| 503` | | | | | |',
    );
  });
});

describe('renderHtml', () => {
  async function page(
    report = makeReport([makeModel('tiny-llm', [makeCase('capital')])]),
    links = {},
  ) {
    const fonts = await loadFontAssets(root);
    return renderHtml(buildView(report), {
      fonts,
      toolVersion: '0.1.0',
      generatedAt: '2026-10-29T12:30:00.000Z',
      links,
    });
  }

  it('is one self-contained document with no network references', async () => {
    const output = await page();
    expect(output.startsWith('<!doctype html>')).toBe(true);
    expect(output).toContain('<title>qvac-eval · smoke · Passed · SDK 0.22.0</title>');
    expect(output).toContain('data:font/woff2;base64,');
    expect(output).not.toMatch(/(?:src|href)="https?:/u);
    expect(output).not.toMatch(/url\(["']?https?:/u);
    expect(output).not.toContain('@import');
    expect((output.match(/<script/gu) ?? []).length).toBe(1);
  });

  it('never lets model output become markup', async () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const report = makeReport([
      makeModel(
        'tiny-llm',
        [
          makeCase('xss', {
            status: 'failed',
            output: hostile,
            checks: [
              { name: 'exact', passed: false, expected: hostile, actual: hostile, detail: hostile },
            ],
            diff: { expected: hostile, actual: hostile },
            error: { kind: 'sdk', message: hostile },
            description: hostile,
          }),
        ],
        {},
        { note: hostile },
      ),
    ]);
    const output = await page(report);
    expect(output).not.toContain('<script>alert');
    expect(output).not.toContain('<img src=x');
    expect(output).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect((output.match(/<script/gu) ?? []).length).toBe(1);
  });

  it('opens failing cases, keeps passing ones closed and marks status for the filters', async () => {
    const output = await page(
      makeReport([
        makeModel('tiny-llm', [
          makeCase('good'),
          makeCase('bad', { status: 'failed', checks: [{ name: 'exact', passed: false }] }),
        ]),
      ]),
    );
    expect(output).toMatch(/<details class="case" data-status="passed" data-model="tiny-llm">/u);
    expect(output).toMatch(
      /<details class="case" data-status="failed" data-model="tiny-llm" open>/u,
    );
    expect(output).toContain(
      'data-kind="status" data-value="failed" aria-pressed="false">Failed<sup><span class="sr"> (</span>1<span class="sr">)</span></sup>',
    );
    expect(output).not.toContain('data-kind="status" data-value="errored"');
  });

  it('offers a model filter only when there is more than one model', async () => {
    expect(await page()).not.toContain('data-kind="model"');
    const two = await page(
      makeReport([makeModel('a', [makeCase('x')]), makeModel('b', [makeCase('x')])]),
    );
    expect(two).toContain('data-kind="model" data-value="b"');
  });

  it('links back to the history and to the run when asked', async () => {
    const output = await page(undefined, {
      history: 'history.html',
      run: 'https://github.com/o/r/actions/runs/1',
    });
    expect(output).toContain('<a href="history.html">← History</a>');
    expect(output).toContain('<a href="https://github.com/o/r/actions/runs/1">The run →</a>');
  });

  it('renders a comparison with a legend and two bars per model', async () => {
    const older = makeReport([makeModel('tiny-llm', [makeCase('a')], { tokensPerSecond: 100 })], {
      sdk: '0.21.1',
    });
    const newer = makeReport([makeModel('tiny-llm', [makeCase('a')], { tokensPerSecond: 80 })], {
      sdk: '0.22.0',
    });
    const fonts = await loadFontAssets(root);
    const output = renderHtml(buildView(newer, compareReports(older, newer, limits)), {
      fonts,
      toolVersion: '0.1.0',
      generatedAt: '2026-10-29T12:30:00.000Z',
    });
    expect(output).toContain('SDK 0.21.1</span>');
    expect(output).toContain('hatch-dense');
    expect(output).toContain('Earlier SDK: passed');
    expect(output).toContain('<span class="chg worse">-20%</span>');
  });
});
