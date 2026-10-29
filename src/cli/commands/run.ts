import { join, resolve } from 'node:path';

import { writeSdkConfig } from '../../adapter/sdk-config.js';
import type { Device } from '../../adapter/types.js';
import { writeReport } from '../../report/io.js';
import { buildView } from '../../report/view.js';
import { exitCodeFor } from '../../report/summary.js';
import { applyBaseline } from '../../run/baseline.js';
import { collectEnvironment } from '../../run/environment.js';
import { runSuite } from '../../run/execute.js';
import {
  buildModelCatalog,
  loadModelRegistry,
  loadSuite,
  selectModels,
} from '../../suites/load.js';
import { resolveBaseline } from '../baseline.js';
import { createStyle, formatBaselineRegressions, formatEvent, formatSummary } from '../console.js';
import { firstExisting, resolveConfig } from '../inputs.js';
import { publish } from '../publish.js';
import type { CliDeps } from '../deps.js';

export interface RunOptions {
  models?: string[];
  sdkVersion?: string;
  repeat: number;
  out: string;
  baseline?: string;
  updateGolden: boolean;
  device: Device;
  goldenDir?: string;
  config?: string;
  modelsFile?: string;
  cacheDir?: string;
  summary?: string;
  verbose: boolean;
}

function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9._+-]+/gu, '-');
}

export async function runCommand(
  suiteArgument: string,
  options: RunOptions,
  deps: CliDeps,
): Promise<number> {
  const style = createStyle(deps.stdout.isTTY === true && deps.env.NO_COLOR === undefined);
  const print = (lines: readonly string[]) => {
    deps.stdout.write(`${lines.join('\n')}\n`);
  };

  const suite = await loadSuite(resolve(deps.cwd, suiteArgument));
  const registryFile =
    options.modelsFile === undefined
      ? await firstExisting([join(deps.cwd, 'models.yaml'), join(deps.packageRoot, 'models.yaml')])
      : resolve(deps.cwd, options.modelsFile);
  const registry =
    registryFile === undefined ? { models: {} } : await loadModelRegistry(registryFile);
  const config = await resolveConfig(options.config, deps);

  const catalog = buildModelCatalog(registry, suite.definition);
  const models = selectModels(options.models, suite.definition, catalog);

  const ownConfig = await firstExisting(
    ['json', 'js', 'ts'].map((extension) => join(deps.cwd, `qvac.config.${extension}`)),
  );
  if (deps.env.QVAC_CONFIG_PATH === undefined && ownConfig === undefined) {
    const modelCacheDir = options.cacheDir ?? deps.env.QVAC_EVAL_MODEL_CACHE;
    deps.env.QVAC_CONFIG_PATH = await writeSdkConfig({
      file: join(deps.cwd, '.qvac-eval', 'qvac.config.json'),
      ...(modelCacheDir !== undefined && { modelCacheDir: resolve(deps.cwd, modelCacheDir) }),
      verbose: options.verbose,
    });
  }

  const session = await deps.openSession({
    ...(options.sdkVersion !== undefined && { sdkVersion: options.sdkVersion }),
    cwd: deps.cwd,
    cacheDir: join(deps.cwd, '.qvac-eval', 'sdk'),
    device: options.device,
    log: (message) => {
      deps.stderr.write(`${message}\n`);
    },
  });

  try {
    const environment = collectEnvironment(deps.env);
    print([
      `${style.bold('qvac-eval')}  suite ${suite.definition.suite}  ·  ${session.sdkName} ${session.sdkVersion}  ·  node ${environment.node}  ·  ${environment.platform} ${environment.arch}  ·  device ${options.device}`,
    ]);

    let report = await runSuite({
      suite,
      models,
      session,
      config,
      repeat: options.repeat,
      device: options.device,
      goldenDir: resolve(deps.cwd, options.goldenDir ?? config.golden.dir),
      updateGolden: options.updateGolden,
      cwd: deps.cwd,
      signal: deps.signal,
      createSampler: deps.createSampler,
      environment,
      now: deps.now,
      onProgress: (event) => {
        print(formatEvent(event, style));
      },
    });

    const outDir = resolve(deps.cwd, options.out);
    if (options.baseline !== undefined) {
      const baseline = await resolveBaseline(options.baseline, {
        cwd: deps.cwd,
        outDir,
        suite: report.suite.name,
        sdkVersion: session.sdkVersion,
      });
      if (baseline === undefined) {
        print(['', style.dim('No baseline found: skipping the comparison.')]);
      } else {
        report = applyBaseline(report, baseline.report, config.thresholds, baseline.source);
        print([
          '',
          style.dim(
            `Compared with the baseline from ${baseline.report.startedAt} (SDK ${baseline.report.environment.sdk.version})`,
          ),
          ...formatBaselineRegressions(report, style),
        ]);
      }
    }

    const name = safeName(
      `${report.suite.name}.${session.sdkVersion}.${models.map((model) => model.id).join('+')}`,
    );
    const jsonFile = join(outDir, `${name}.json`);
    await writeReport(jsonFile, report);
    const links =
      report.environment.ci?.runUrl === undefined ? {} : { run: report.environment.ci.runUrl };
    const written = await publish(
      buildView(report),
      { html: join(outDir, `${name}.html`), summary: options.summary },
      deps,
      links,
    );

    print(formatSummary(report, style));
    print([
      '',
      ...[jsonFile, ...written.filter((file) => file !== options.summary)].map((file) =>
        style.dim(`Wrote ${file}`),
      ),
    ]);
    return exitCodeFor(report.verdict);
  } finally {
    await session.close();
  }
}
