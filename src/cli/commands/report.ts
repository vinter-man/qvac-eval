import { join, resolve } from 'node:path';

import { UsageError } from '../../errors.js';
import { loadReports, mergeReports, writeReport } from '../../report/io.js';
import { compareReports, type Comparison } from '../../report/compare.js';
import type { RunReport } from '../../report/schema.js';
import { exitCodeFor } from '../../report/summary.js';
import { buildView } from '../../report/view.js';
import { applyBaseline } from '../../run/baseline.js';
import { resolveBaseline } from '../baseline.js';
import { createStyle, formatBaselineRegressions, formatSummary } from '../console.js';
import type { CliDeps } from '../deps.js';
import { displayPath, resolveConfig } from '../inputs.js';
import { publish, type PublishLinks } from '../publish.js';
import { publishSite } from '../site.js';

export interface ReportOptions {
  html?: string;
  md?: string;
  summary?: string;
  mergedDir?: string;
  baseline?: string;
  config?: string;
  historyLink?: string;
  site?: string;
  previous?: string;
  keep: number;
}

async function loadGroups(paths: readonly string[], deps: CliDeps): Promise<RunReport[]> {
  return mergeReports(await loadReports(paths.map((path) => resolve(deps.cwd, path))));
}

async function loadSingle(path: string, deps: CliDeps): Promise<RunReport> {
  const groups = await loadGroups([path], deps);
  const [only, ...extra] = groups;
  if (only === undefined || extra.length > 0) {
    throw new UsageError(
      `${path} must hold the reports of exactly one SDK version`,
      groups.map((group) => group.environment.sdk.version),
    );
  }
  return only;
}

async function finish(
  groups: readonly RunReport[],
  options: ReportOptions,
  deps: CliDeps,
): Promise<number> {
  const config = await resolveConfig(options.config, deps);
  const style = createStyle(deps.stdout.isTTY === true && deps.env.NO_COLOR === undefined);
  const [first, second, ...rest] = groups;
  if (first === undefined) throw new UsageError('No reports to show');
  if (rest.length > 0) {
    throw new UsageError(
      'Reports of more than two SDK versions cannot be shown together',
      groups.map((group) => group.environment.sdk.version),
    );
  }

  let final: RunReport = first;
  let comparison: Comparison | undefined;
  if (second !== undefined) {
    if (options.baseline !== undefined) {
      throw new UsageError(
        '--baseline cannot be combined with two SDK versions: the older version is the baseline',
      );
    }
    comparison = compareReports(first, second, config.thresholds);
    final = comparison.newer;
  } else if (options.baseline !== undefined) {
    const baseline = await resolveBaseline(options.baseline, {
      cwd: deps.cwd,
      outDir: deps.cwd,
      suite: first.suite.name,
      sdkVersion: first.environment.sdk.version,
    });
    if (baseline !== undefined)
      final = applyBaseline(first, baseline.report, config.thresholds, baseline.source);
  }

  const view = buildView(final, comparison);
  const links: PublishLinks = {
    ...(options.historyLink !== undefined && { history: options.historyLink }),
    ...(final.environment.ci?.runUrl !== undefined && { run: final.environment.ci.runUrl }),
  };
  const written = await publish(
    view,
    { html: options.html, markdown: options.md, summary: options.summary },
    deps,
    links,
  );

  if (options.site !== undefined) {
    written.push(
      ...(await publishSite(
        view,
        final,
        { directory: options.site, previous: options.previous, keep: options.keep },
        deps,
      )),
    );
  }

  if (options.mergedDir !== undefined) {
    const directory = resolve(deps.cwd, options.mergedDir);
    for (const content of comparison === undefined
      ? [final]
      : [comparison.older, comparison.newer]) {
      const file = join(
        directory,
        `${content.suite.name}.${content.environment.sdk.version}.merged.json`,
      );
      await writeReport(file, content);
      written.push(file);
    }
  }

  const lines = [
    `${style.bold('qvac-eval')}  suite ${final.suite.name}  ·  ${view.sdkLabel}  ·  ${view.platformLabel}`,
    ...formatBaselineRegressions(final, style),
    ...formatSummary(final, style),
    '',
    ...written.map((file) => style.dim(`Wrote ${displayPath(file, deps)}`)),
  ];
  deps.stdout.write(`${lines.join('\n')}\n`);
  return exitCodeFor(final.verdict);
}

export async function reportCommand(
  inputs: readonly string[],
  options: ReportOptions,
  deps: CliDeps,
): Promise<number> {
  return finish(await loadGroups(inputs, deps), options, deps);
}

export async function compareCommand(
  olderPath: string,
  newerPath: string,
  options: ReportOptions,
  deps: CliDeps,
): Promise<number> {
  const older = await loadSingle(olderPath, deps);
  const newer = await loadSingle(newerPath, deps);
  return finish([older, newer], options, deps);
}
