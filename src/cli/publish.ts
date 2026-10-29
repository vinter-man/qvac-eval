import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { loadFontAssets } from '../report/html/assets.js';
import { renderHtml } from '../report/html/render.js';
import { writeFileEnsuringDir } from '../report/io.js';
import { renderMarkdown } from '../report/markdown.js';
import type { ReportView } from '../report/view.js';
import { TOOL_VERSION } from '../version.js';
import type { CliDeps } from './deps.js';

export interface PublishTargets {
  html?: string | undefined;
  markdown?: string | undefined;
  summary?: string | undefined;
}

export interface PublishLinks {
  history?: string;
  run?: string;
}

export async function publish(
  view: ReportView,
  targets: PublishTargets,
  deps: CliDeps,
  links: PublishLinks = {},
): Promise<string[]> {
  const written: string[] = [];

  if (targets.html !== undefined) {
    const file = resolve(deps.cwd, targets.html);
    const fonts = await loadFontAssets(deps.packageRoot);
    await writeFileEnsuringDir(
      file,
      renderHtml(view, {
        fonts,
        toolVersion: TOOL_VERSION,
        generatedAt: deps.now().toISOString(),
        links,
      }),
    );
    written.push(file);
  }

  const markdown =
    targets.markdown !== undefined || targets.summary !== undefined ? renderMarkdown(view) : '';
  if (targets.markdown !== undefined) {
    const file = resolve(deps.cwd, targets.markdown);
    await writeFileEnsuringDir(file, markdown);
    written.push(file);
  }
  if (targets.summary !== undefined) {
    const file = resolve(deps.cwd, targets.summary);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${markdown}\n`);
    written.push(file);
  }
  return written;
}
