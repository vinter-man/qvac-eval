import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeSdkConfig } from '../src/adapter/sdk-config.js';
import {
  ensureSdkInstalled,
  locateSdk,
  openQvacSession,
  resolveSdkVersion,
  type NpmRunner,
} from '../src/adapter/sdk-loader.js';
import { InfraError, UsageError } from '../src/errors.js';
import { makeWorkspace } from './support/workspace.js';

async function installFakeSdk(root: string, version: string): Promise<void> {
  const directory = join(root, 'node_modules', '@qvac', 'sdk');
  await mkdir(join(directory, 'dist'), { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: '@qvac/sdk', version, main: 'dist/index.js' }),
  );
  await writeFile(join(directory, 'dist', 'index.js'), 'module.exports = {};\n');
}

describe('locateSdk', () => {
  it('finds the SDK entry point and its version', async () => {
    const root = await makeWorkspace({});
    await installFakeSdk(root, '0.22.0');
    const found = await locateSdk(root);
    expect(found.version).toBe('0.22.0');
    expect(found.entry).toMatch(/node_modules\/@qvac\/sdk\/dist\/index\.js$/u);
  });

  it('explains how to get the SDK when it is not installed', async () => {
    const root = await makeWorkspace({});
    const error = await locateSdk(root).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).details[0]).toContain('--sdk-version');
  });
});

describe('resolveSdkVersion', () => {
  const answering =
    (output: string): NpmRunner =>
    () =>
      Promise.resolve(output);

  it('keeps an exact version without asking npm', async () => {
    const never: NpmRunner = () => Promise.reject(new Error('should not be called'));
    expect(await resolveSdkVersion('0.21.1', never)).toBe('0.21.1');
    expect(await resolveSdkVersion('0.22.0-dev.3', never)).toBe('0.22.0-dev.3');
  });

  it('resolves a tag and takes the newest match of a range', async () => {
    expect(await resolveSdkVersion('latest', answering('"0.22.0"\n'))).toBe('0.22.0');
    expect(await resolveSdkVersion('^0.21.0', answering('["0.21.0","0.21.1"]'))).toBe('0.21.1');
  });

  it('reports an unknown tag as an infrastructure error', async () => {
    const failing: NpmRunner = () => Promise.reject(new Error('E404 not found'));
    await expect(resolveSdkVersion('nightly', failing)).rejects.toThrow(InfraError);
    await expect(resolveSdkVersion('nightly', failing)).rejects.toThrow('E404 not found');
  });
});

describe('ensureSdkInstalled', () => {
  it('installs into a directory named after the version, once', async () => {
    const cache = await makeWorkspace({});
    const calls: string[][] = [];
    const logs: string[] = [];
    const npm: NpmRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'install') await installFakeSdk(join(cache, '0.21.1'), '0.21.1');
      return '';
    };

    const first = await ensureSdkInstalled('0.21.1', cache, npm, (message) => logs.push(message));
    expect(first.version).toBe('0.21.1');
    expect(calls[0]).toEqual([
      'install',
      '--prefix',
      join(cache, '0.21.1'),
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--loglevel',
      'error',
      '@qvac/sdk@0.21.1',
    ]);
    expect(logs[0]).toContain('Installing @qvac/sdk@0.21.1');

    await ensureSdkInstalled('0.21.1', cache, npm, (message) => logs.push(message));
    expect(calls).toHaveLength(1);
  });

  it('turns a failed install into an infrastructure error', async () => {
    const cache = await makeWorkspace({});
    const npm: NpmRunner = () => Promise.reject(new Error('ENOSPC'));
    await expect(ensureSdkInstalled('0.21.1', cache, npm, () => undefined)).rejects.toThrow(
      'Cannot install @qvac/sdk@0.21.1: ENOSPC',
    );
  });
});

describe('openQvacSession', () => {
  async function sessionOptions(heartbeat: () => Promise<unknown>) {
    const cwd = await makeWorkspace({});
    await installFakeSdk(cwd, '0.22.0');
    const closed: string[] = [];
    return {
      closed,
      options: {
        cwd,
        cacheDir: join(cwd, '.cache'),
        device: 'cpu' as const,
        importModule: () =>
          Promise.resolve({
            heartbeat,
            close: () => {
              closed.push('closed');
              return Promise.resolve();
            },
          }),
      },
    };
  }

  it('warms the worker up, exposes the SDK version and closes it', async () => {
    let beats = 0;
    const { options, closed } = await sessionOptions(() => {
      beats += 1;
      return Promise.resolve({});
    });
    const session = await openQvacSession(options);
    expect(beats).toBe(1);
    expect(session).toMatchObject({ sdkName: '@qvac/sdk', sdkVersion: '0.22.0' });
    expect(typeof session.createRunner().load).toBe('function');
    await session.close();
    expect(closed).toEqual(['closed']);
  });

  it('reports a worker that does not start', async () => {
    const { options } = await sessionOptions(() => Promise.reject(new Error('spawn bare ENOENT')));
    await expect(openQvacSession(options)).rejects.toThrow(
      'The QVAC worker did not start: spawn bare ENOENT',
    );
  });

  it('reports a module that cannot be imported', async () => {
    const { options } = await sessionOptions(() => Promise.resolve({}));
    await expect(
      openQvacSession({
        ...options,
        importModule: () =>
          Promise.reject(new Error('libatomic.so.1: cannot open shared object file')),
      }),
    ).rejects.toThrow('libatomic.so.1');
  });

  it('installs the requested version before opening it', async () => {
    const cwd = await makeWorkspace({});
    const cacheDir = join(cwd, '.cache');
    const npm: NpmRunner = async (args) => {
      if (args[0] === 'install') await installFakeSdk(join(cacheDir, '0.21.1'), '0.21.1');
      return '';
    };
    const session = await openQvacSession({
      sdkVersion: '0.21.1',
      cwd,
      cacheDir,
      device: 'cpu',
      npm,
      importModule: () => Promise.resolve({}),
    });
    expect(session.sdkVersion).toBe('0.21.1');
  });
});

describe('writeSdkConfig', () => {
  it('silences the SDK by default and can point it at a model cache', async () => {
    const root = await makeWorkspace({});
    const quiet = await writeSdkConfig({
      file: join(root, 'a', 'qvac.config.json'),
      verbose: false,
    });
    expect(JSON.parse(await readFile(quiet, 'utf8'))).toEqual({
      loggerLevel: 'error',
      loggerConsoleOutput: false,
    });
    const loud = await writeSdkConfig({
      file: join(root, 'b.json'),
      verbose: true,
      modelCacheDir: '/cache/models',
    });
    expect(JSON.parse(await readFile(loud, 'utf8'))).toEqual({
      loggerLevel: 'info',
      loggerConsoleOutput: true,
      cacheDirectory: '/cache/models',
    });
  });
});
