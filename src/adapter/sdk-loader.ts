import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { z } from 'zod';

import { describeError, InfraError, UsageError } from '../errors.js';
import { QvacRunner } from './qvac-runner.js';
import type { QvacSdkModule } from './sdk-api.js';
import type { Device, RunnerSession } from './types.js';

const execFileAsync = promisify(execFile);

export const SDK_PACKAGE = '@qvac/sdk';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

const manifestSchema = z.object({ name: z.string(), version: z.string() });

export type NpmRunner = (args: readonly string[]) => Promise<string>;

export interface SdkLocation {
  entry: string;
  version: string;
}

export interface OpenSessionOptions {
  sdkVersion?: string;
  cwd: string;
  cacheDir: string;
  device: Device;
  npm?: NpmRunner;
  log?: (message: string) => void;
  importModule?: (specifier: string) => Promise<unknown>;
}

export const defaultNpm: NpmRunner = async (args) => {
  const binary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { stdout } = await execFileAsync(binary, [...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
};

async function readManifest(directory: string) {
  const text = await readFile(join(directory, 'package.json'), 'utf8');
  return manifestSchema.parse(JSON.parse(text));
}

async function findPackageRoot(entry: string): Promise<string> {
  let directory = dirname(entry);
  for (;;) {
    const manifest = await readManifest(directory).catch(() => undefined);
    if (manifest?.name === SDK_PACKAGE) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot find the ${SDK_PACKAGE} package root above ${entry}`);
    }
    directory = parent;
  }
}

export async function locateSdk(from: string): Promise<SdkLocation> {
  let entry: string;
  try {
    entry = createRequire(join(from, 'noop.js')).resolve(SDK_PACKAGE);
  } catch {
    throw new UsageError(`${SDK_PACKAGE} is not installed in ${from}`, [
      `Install it with "npm i ${SDK_PACKAGE}" or pass --sdk-version <version> to let qvac-eval install one.`,
    ]);
  }
  const root = await findPackageRoot(entry);
  return { entry, version: (await readManifest(root)).version };
}

export async function resolveSdkVersion(
  spec: string,
  npm: NpmRunner,
  options: { verify?: boolean } = {},
): Promise<string> {
  if (EXACT_VERSION.test(spec) && options.verify !== true) return spec;
  let output: string;
  try {
    output = await npm(['view', `${SDK_PACKAGE}@${spec}`, 'version', '--json']);
  } catch (error) {
    throw new InfraError(`Cannot resolve ${SDK_PACKAGE}@${spec}: ${describeError(error)}`, {
      cause: error,
    });
  }
  const parsed: unknown = JSON.parse(output);
  const versions = z.union([z.string(), z.array(z.string())]).parse(parsed);
  const version = Array.isArray(versions) ? versions.at(-1) : versions;
  if (version === undefined)
    throw new InfraError(`${SDK_PACKAGE}@${spec} matches no published version`);
  return version;
}

export async function ensureSdkInstalled(
  spec: string,
  cacheDir: string,
  npm: NpmRunner,
  log: (message: string) => void,
): Promise<SdkLocation> {
  const version = await resolveSdkVersion(spec, npm);
  const directory = join(cacheDir, version);

  try {
    await access(join(directory, 'node_modules', SDK_PACKAGE, 'package.json'));
  } catch {
    log(`Installing ${SDK_PACKAGE}@${version} into ${directory} (about 2 GB, once)`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), `${JSON.stringify({ private: true })}\n`);
    try {
      await npm([
        'install',
        '--prefix',
        directory,
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--loglevel',
        'error',
        `${SDK_PACKAGE}@${version}`,
      ]);
    } catch (error) {
      throw new InfraError(`Cannot install ${SDK_PACKAGE}@${version}: ${describeError(error)}`, {
        cause: error,
      });
    }
  }
  return locateSdk(directory);
}

export async function openQvacSession(options: OpenSessionOptions): Promise<RunnerSession> {
  const npm = options.npm ?? defaultNpm;
  const log = options.log ?? (() => undefined);
  const location =
    options.sdkVersion === undefined
      ? await locateSdk(options.cwd)
      : await ensureSdkInstalled(options.sdkVersion, options.cacheDir, npm, log);

  const importModule = options.importModule ?? ((specifier: string) => import(specifier));
  let sdk: QvacSdkModule;
  try {
    sdk = (await importModule(pathToFileURL(location.entry).href)) as QvacSdkModule;
  } catch (error) {
    throw new InfraError(
      `Cannot load ${SDK_PACKAGE} ${location.version}: ${describeError(error)}`,
      { cause: error },
    );
  }

  try {
    await sdk.heartbeat?.();
  } catch (error) {
    throw new InfraError(`The QVAC worker did not start: ${describeError(error)}`, {
      cause: error,
    });
  }

  return {
    sdkName: SDK_PACKAGE,
    sdkVersion: location.version,
    createRunner: () => new QvacRunner(sdk, { device: options.device }),
    close: async () => {
      await sdk.close?.();
    },
  };
}
