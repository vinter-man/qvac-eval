import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadFontAssets } from '../report/html/assets.js';
import { renderHistory } from '../report/html/history.js';
import { renderHtml } from '../report/html/render.js';
import { addEntry, entryFromReport, historySchema, type History } from '../report/history.js';
import { writeFileEnsuringDir } from '../report/io.js';
import type { RunReport } from '../report/schema.js';
import type { ReportView } from '../report/view.js';
import { TOOL_VERSION } from '../version.js';
import type { CliDeps } from './deps.js';

export interface SiteOptions {
  directory: string;
  previous?: string | undefined;
  keep: number;
}

async function readPreviousHistory(directory: string, deps: CliDeps): Promise<History | undefined> {
  let text: string;
  try {
    text = await readFile(join(directory, 'history.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return historySchema.parse(JSON.parse(text));
  } catch {
    deps.stderr.write(
      `warning: ${join(directory, 'history.json')} is unreadable; starting the history afresh\n`,
    );
    return undefined;
  }
}

async function copyKeptPages(
  previousDir: string | undefined,
  pages: readonly string[],
  siteDir: string,
): Promise<void> {
  if (previousDir === undefined) return;
  for (const page of pages) {
    try {
      await mkdir(join(siteDir, 'runs'), { recursive: true });
      await copyFile(join(previousDir, page), join(siteDir, page));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function publishSite(
  view: ReportView,
  report: RunReport,
  options: SiteOptions,
  deps: CliDeps,
): Promise<string[]> {
  const siteDir = resolve(deps.cwd, options.directory);
  const previousDir =
    options.previous === undefined ? undefined : resolve(deps.cwd, options.previous);
  const previous =
    previousDir === undefined ? undefined : await readPreviousHistory(previousDir, deps);

  const entry = entryFromReport(report, view.sdkLabel);
  const { history, kept } = addEntry(previous, entry, options.keep);
  await copyKeptPages(
    previousDir,
    kept.map((candidate) => candidate.page),
    siteDir,
  );

  const fonts = await loadFontAssets(deps.packageRoot);
  const common = { fonts, toolVersion: TOOL_VERSION, generatedAt: deps.now().toISOString() };
  const runUrl = report.environment.ci?.runUrl;
  const run = runUrl === undefined ? {} : { run: runUrl };

  const files = {
    index: join(siteDir, 'index.html'),
    runPage: join(siteDir, entry.page),
    history: join(siteDir, 'history.html'),
    data: join(siteDir, 'history.json'),
  };
  await writeFileEnsuringDir(
    files.index,
    renderHtml(view, { ...common, links: { history: 'history.html', ...run } }),
  );
  await writeFileEnsuringDir(
    files.runPage,
    renderHtml(view, { ...common, links: { history: '../history.html', ...run } }),
  );
  await writeFileEnsuringDir(files.history, renderHistory(history, common));
  await writeFileEnsuringDir(files.data, `${JSON.stringify(history, null, 2)}\n`);
  return Object.values(files);
}
