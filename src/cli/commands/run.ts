import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { writeSdkConfig } from '../../adapter/sdk-config.js';
import type { Device } from '../../adapter/types.js';
import { writeReport } from '../../report/io.js';
import { exitCodeFor } from '../../report/summary.js';
import { applyBaseline } from '../../run/baseline.js';
import { collectEnvironment } from '../../run/environment.js';
import { runSuite } from '../../run/execute.js';
import {
  buildModelCatalog,
  loadConfig,
  loadModelRegistry,
  loadSuite,
  selectModels,
} from '../../suites/load.js';
import { resolveBaseline } from '../baseline.js';
import { createStyle, formatBaselineRegressions, formatEvent, formatSummary } from '../console.js';
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
  verbose: boolean;
}

async function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
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
  const configFile =
    options.config === undefined
      ? await firstExisting([join(deps.cwd, 'qvac-eval.config.yaml')])
      : resolve(deps.cwd, options.config);
  const config = await loadConfig(configFile);

  const catalog = buildModelCatalog(registry, suite.definition);
  const models = selectModels(options.models, suite.definition, catalog);

  if (deps.env.QVAC_CONFIG_PATH === undefined) {
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

    print(formatSummary(report, style));
    print(['', style.dim(`Report: ${jsonFile}`)]);
    return exitCodeFor(report.verdict);
  } finally {
    await session.close();
  }
}
