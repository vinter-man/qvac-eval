import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadConfig } from '../suites/load.js';
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
