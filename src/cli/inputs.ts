import { access } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  assertCaseModelsKnown,
  buildModelCatalog,
  loadConfig,
  loadModelRegistry,
  type LoadedSuite,
  type ResolvedModel,
} from '../suites/load.js';
import type { EvalConfig } from '../suites/schema.js';
import type { CliDeps } from './deps.js';

export async function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
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

export async function resolveConfig(
  option: string | undefined,
  deps: CliDeps,
): Promise<EvalConfig> {
  const file =
    option === undefined
      ? await firstExisting([join(deps.cwd, 'qvac-eval.config.yaml')])
      : resolve(deps.cwd, option);
  return loadConfig(file);
}

export function displayPath(file: string, deps: CliDeps): string {
  const shown = relative(deps.cwd, file);
  return shown === '' || shown.startsWith('..') || isAbsolute(shown) ? file : shown;
}

export async function loadModelCatalog(
  suite: LoadedSuite,
  modelsFile: string | undefined,
  deps: CliDeps,
): Promise<Map<string, ResolvedModel>> {
  const registryFile =
    modelsFile === undefined
      ? await firstExisting([join(deps.cwd, 'models.yaml'), join(deps.packageRoot, 'models.yaml')])
      : resolve(deps.cwd, modelsFile);
  const registry =
    registryFile === undefined ? { models: {} } : await loadModelRegistry(registryFile);
  const catalog = buildModelCatalog(registry, suite.definition);
  assertCaseModelsKnown(suite.file, suite.definition, catalog);
  return catalog;
}
