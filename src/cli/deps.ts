import type { RunnerSession } from '../adapter/types.js';
import { openQvacSession, type OpenSessionOptions } from '../adapter/sdk-loader.js';
import { PACKAGE_ROOT } from '../paths.js';
import { createDefaultSamplerFactory, type MemorySamplerFactory } from '../run/memory.js';

export interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface CliDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Output;
  stderr: Output;
  now: () => Date;
  packageRoot: string;
  signal: AbortSignal;
  openSession: (options: OpenSessionOptions) => Promise<RunnerSession>;
  createSampler: MemorySamplerFactory;
}

export function createDefaultDeps(signal: AbortSignal): CliDeps {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => new Date(),
    packageRoot: PACKAGE_ROOT,
    signal,
    openSession: openQvacSession,
    createSampler: createDefaultSamplerFactory(),
  };
}
