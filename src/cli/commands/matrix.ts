import { resolve } from 'node:path';

import { resolveSdkVersion } from '../../adapter/sdk-loader.js';
import { UsageError } from '../../errors.js';
import { loadSuite, modelsWithCases, selectModels } from '../../suites/load.js';
import type { CliDeps } from '../deps.js';
import { loadModelCatalog } from '../inputs.js';

export interface MatrixOptions {
  models?: string[];
  sdk: string[];
  runners: string[];
  modelsFile?: string;
}

interface MatrixEntry {
  model: string;
  kind: string;
  source: string;
  cases: number;
  sdks: string[];
  runner: string;
}

interface MatrixPlan {
  suite: string;
  compare: boolean;
  sdks: string[];
  runners: string[];
  include: MatrixEntry[];
}

async function planMatrix(
  suiteArgument: string,
  options: MatrixOptions,
  deps: CliDeps,
): Promise<MatrixPlan> {
  const suite = await loadSuite(resolve(deps.cwd, suiteArgument));
  const catalog = await loadModelCatalog(suite, options.modelsFile, deps);
  const models = selectModels(options.models, suite.definition, catalog);

  const eligible = modelsWithCases(suite.definition, models);
  if (eligible.length === 0) {
    throw new UsageError(
      `None of the models has a case in the suite "${suite.definition.suite}"`,
      models.map((model) => `${model.id} (${model.kind})`),
    );
  }
  for (const model of models) {
    if (!eligible.some((entry) => entry.model.id === model.id)) {
      deps.stderr.write(`note: ${model.id} is left out, the suite has no ${model.kind} cases\n`);
    }
  }

  const sdks = [
    ...new Set(
      await Promise.all(
        options.sdk.map((spec) => resolveSdkVersion(spec, deps.npm, { verify: true })),
      ),
    ),
  ];
  if (sdks.length > 2) {
    throw new UsageError('At most two SDK versions can be compared in one run', sdks);
  }
  if (options.runners.length === 0) throw new UsageError('At least one runner is needed');

  return {
    suite: suite.definition.suite,
    compare: sdks.length === 2,
    sdks,
    runners: options.runners,
    include: options.runners.flatMap((runner) =>
      eligible.map(({ model, cases }) => ({
        model: model.id,
        kind: model.kind,
        source: model.source,
        cases,
        sdks,
        runner,
      })),
    ),
  };
}

export async function matrixCommand(
  suiteArgument: string,
  options: MatrixOptions,
  deps: CliDeps,
): Promise<number> {
  deps.stdout.write(`${JSON.stringify(await planMatrix(suiteArgument, options, deps))}\n`);
  return 0;
}
