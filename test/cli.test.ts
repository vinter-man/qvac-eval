import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { OpenSessionOptions } from '../src/adapter/sdk-loader.js';
import type { RunnerSession } from '../src/adapter/types.js';
import type { CliDeps } from '../src/cli/deps.js';
import { main } from '../src/cli/main.js';
import { UsageError } from '../src/errors.js';
import {
  completion,
  createFakeSession,
  hangUntilAborted,
  noMemory,
  type FakeBehavior,
  type FakeSession,
} from './support/fakes.js';
import { makeWorkspace, MODELS_YAML, SUITE_YAML } from './support/workspace.js';

interface Cli {
  root: string;
  session: FakeSession;
  opened: OpenSessionOptions[];
  stdout: string[];
  stderr: string[];
  env: NodeJS.ProcessEnv;
  controller: AbortController;
  run: (...argv: string[]) => Promise<number>;
}

const good: FakeBehavior = {
  complete: (request) =>
    completion(request.messages[0]?.content.includes('{') ? '{"ok": true}' : 'Paris'),
};

async function cli(
  behavior: FakeBehavior,
  options: { files?: Record<string, string>; env?: NodeJS.ProcessEnv; openFails?: Error } = {},
): Promise<Cli> {
  const root = await makeWorkspace({
    'models.yaml': MODELS_YAML,
    'cases/demo.yaml': SUITE_YAML,
    ...options.files,
  });
  const session = createFakeSession({ 'tiny-llm': behavior });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const opened: OpenSessionOptions[] = [];
  const env: NodeJS.ProcessEnv = { ...options.env };
  const controller = new AbortController();
  const deps: CliDeps = {
    cwd: root,
    env,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
    now: () => new Date('2026-10-29T12:00:00.000Z'),
    packageRoot: root,
    signal: controller.signal,
    createSampler: noMemory,
    openSession: (sessionOptions): Promise<RunnerSession> => {
      opened.push(sessionOptions);
      if (options.openFails !== undefined) return Promise.reject(options.openFails);
      return Promise.resolve(session);
    },
  };
  return {
    root,
    session,
    opened,
    stdout,
    stderr,
    env,
    controller,
    run: (...argv) => main(argv, deps),
  };
}

describe('exit codes', () => {
  it('exits 0 when every case passes and writes the JSON report', async () => {
    const harness = await cli(good);
    expect(await harness.run('run', 'cases/demo.yaml')).toBe(0);
    const files = await readdir(join(harness.root, 'reports'));
    expect(files).toEqual(['demo.0.22.0.tiny-llm.json']);
    const report = JSON.parse(
      await readFile(join(harness.root, 'reports', files[0] ?? ''), 'utf8'),
    ) as { verdict: string };
    expect(report.verdict).toBe('pass');
    const output = harness.stdout.join('');
    expect(output).toContain('suite demo');
    expect(output).toContain('@qvac/sdk 0.22.0');
    expect(output).toContain('✓ capital');
    expect(output).toContain('Result  2 passed, 0 failed, 0 regressed, 0 errored of 2 cases');
    expect(harness.session.closed).toBe(true);
  });

  it('exits 1 when a case fails and prints what was expected and what came back', async () => {
    const harness = await cli({ complete: () => completion('Lyon') });
    expect(await harness.run('run', 'cases/demo.yaml')).toBe(1);
    const output = harness.stdout.join('');
    expect(output).toContain('✕ capital');
    expect(output).toContain('contains: expected "Paris", got "Lyon" (missing "Paris")');
    expect(output).toContain('2 failed');
    expect(output).toContain('jsonSchema: expected JSON that matches the schema, got "Lyon"');
  });

  it('exits 1 when a case times out', async () => {
    const harness = await cli({ complete: (_request, signal) => hangUntilAborted(signal) });
    expect(await harness.run('run', 'cases/demo.yaml')).toBe(1);
    expect(harness.stdout.join('')).toContain('timeout: Timed out after 400 ms');
  });

  it('exits 2, and still writes the report, when a model cannot be loaded', async () => {
    const harness = await cli({
      load: () => {
        throw new Error('download failed');
      },
    });
    expect(await harness.run('run', 'cases/demo.yaml')).toBe(2);
    expect(harness.stdout.join('')).toContain('model failed to load: download failed');
    expect(await readdir(join(harness.root, 'reports'))).toHaveLength(1);
    expect(harness.session.closed).toBe(true);
  });

  it('exits 2 when the SDK itself cannot be opened', async () => {
    const harness = await cli(good, {
      openFails: new UsageError('@qvac/sdk is not installed', [
        'Install it with "npm i @qvac/sdk"',
      ]),
    });
    expect(await harness.run('run', 'cases/demo.yaml')).toBe(2);
    expect(harness.stderr.join('')).toBe(
      'error: @qvac/sdk is not installed\n  Install it with "npm i @qvac/sdk"\n',
    );
  });

  it('exits 2 for a suite that does not match the schema and names the path', async () => {
    const harness = await cli(good, {
      files: {
        'cases/bad.yaml':
          'suite: bad\ncases:\n  - { id: a, kind: completion, input: Hi, expect: { contain: [x] } }\n',
      },
    });
    expect(await harness.run('run', 'cases/bad.yaml')).toBe(2);
    const message = harness.stderr.join('');
    expect(message).toContain('cases/bad.yaml does not match the expected format');
    expect(message).toContain('cases[0].expect');
    expect(harness.opened).toEqual([]);
  });

  it('exits 2 for a missing suite file and for an unknown model', async () => {
    const harness = await cli(good);
    expect(await harness.run('run', 'cases/missing.yaml')).toBe(2);
    expect(harness.stderr.join('')).toContain('file not found');
    const unknown = await cli(good);
    expect(await unknown.run('run', 'cases/demo.yaml', '--models', 'no-such-model')).toBe(2);
    expect(unknown.stderr.join('')).toContain('Unknown model "no-such-model"');
  });

  it('exits 2 for bad arguments and 0 for help and version', async () => {
    const bad = await cli(good);
    expect(await bad.run('run', 'cases/demo.yaml', '--repeat', '0')).toBe(2);
    expect(bad.stderr.join('')).toContain('must be a whole number, 1 or more');
    expect(await bad.run('run', 'cases/demo.yaml', '--device', 'tpu')).toBe(2);
    expect(await bad.run('frobnicate')).toBe(2);

    const help = await cli(good);
    expect(await help.run('--help')).toBe(0);
    expect(help.stdout.join('')).toContain('Usage: qvac-eval');
    expect(await help.run('--version')).toBe(0);
    expect(help.stdout.join('')).toMatch(/\d+\.\d+\.\d+/u);
  });

  it('exits 130 on interruption, after unloading the model and closing the SDK', async () => {
    const harness = await cli({
      complete: (_request, signal) => {
        harness.controller.abort();
        return hangUntilAborted(signal);
      },
    });
    expect(await harness.run('run', 'cases/demo.yaml')).toBe(130);
    expect(harness.session.calls.at(-1)).toBe('unload:tiny-llm');
    expect(harness.session.closed).toBe(true);
    expect(harness.stderr.join('')).toContain('Interrupted');
  });
});

describe('run options', () => {
  it('passes the SDK version, device and cache locations to the session', async () => {
    const harness = await cli(good);
    await harness.run(
      'run',
      'cases/demo.yaml',
      '--sdk-version',
      '0.21.1',
      '--device',
      'auto',
      '--cache-dir',
      'weights',
    );
    expect(harness.opened[0]).toMatchObject({
      sdkVersion: '0.21.1',
      device: 'auto',
      cwd: harness.root,
    });
    expect(harness.opened[0]?.cacheDir).toBe(join(harness.root, '.qvac-eval', 'sdk'));
    const config = JSON.parse(
      await readFile(join(harness.root, '.qvac-eval', 'qvac.config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(config).toEqual({
      loggerLevel: 'error',
      loggerConsoleOutput: false,
      cacheDirectory: join(harness.root, 'weights'),
    });
    expect(harness.env.QVAC_CONFIG_PATH).toBe(join(harness.root, '.qvac-eval', 'qvac.config.json'));
  });

  it('leaves an SDK config the user already chose alone', async () => {
    const harness = await cli(good, { env: { QVAC_CONFIG_PATH: '/my/qvac.json' } });
    await harness.run('run', 'cases/demo.yaml');
    expect(harness.env.QVAC_CONFIG_PATH).toBe('/my/qvac.json');
    await expect(access(join(harness.root, '.qvac-eval', 'qvac.config.json'))).rejects.toThrow();
  });

  it('runs the models given on the command line instead of the suite default', async () => {
    const harness = await cli(good, {
      files: {
        'cases/two.yaml':
          'suite: two\nmodels: [tiny-llm]\ncases:\n  - { id: a, kind: completion, input: Hi }\n',
      },
    });
    await harness.run('run', 'cases/two.yaml', '--models', 'tiny-llm,tiny-asr');
    expect(harness.stdout.join('')).toContain('tiny-asr');
    expect(harness.stdout.join('')).toContain('skipped: the suite has no cases for asr models');
  });

  it('records golden outputs with --update-golden and then compares against them', async () => {
    const suite =
      'suite: g\nmodels: [tiny-llm]\ncases:\n  - { id: a, kind: completion, input: Hi, expect: { golden: true } }\n';
    const harness = await cli(
      { complete: () => completion('The capital of France is Paris.') },
      { files: { 'cases/g.yaml': suite } },
    );
    expect(await harness.run('run', 'cases/g.yaml', '--update-golden')).toBe(0);
    expect(harness.stdout.join('')).toContain('golden: 1 case(s) written');
    await access(join(harness.root, 'golden', 'tiny-llm', '0.22.0', 'g.json'));

    const drifted = await cli(
      { complete: () => completion('Lyon') },
      { files: { 'cases/g.yaml': suite } },
    );
    expect(
      await drifted.run('run', 'cases/g.yaml', '--golden-dir', join(harness.root, 'golden')),
    ).toBe(1);
    expect(drifted.stdout.join('')).toContain('▲ a');
    expect(drifted.stdout.join('')).toContain('1 regressed');
  });
});

describe('baseline', () => {
  const slow = (rate: number): FakeBehavior => ({
    complete: (request) =>
      completion(request.messages[0]?.content.includes('{') ? '{"ok": true}' : 'Paris', {
        generatedTokens: 32,
        tokensPerSecond: rate,
      }),
  });

  it('compares with the newest report in --out when asked for "latest"', async () => {
    const first = await cli(slow(200));
    expect(await first.run('run', 'cases/demo.yaml')).toBe(0);

    const second = await cli(slow(100), { files: {} });
    const reports = await readFile(
      join(first.root, 'reports', 'demo.0.22.0.tiny-llm.json'),
      'utf8',
    );
    const target = join(second.root, 'reports');
    await (await import('node:fs/promises')).mkdir(target, { recursive: true });
    await (await import('node:fs/promises')).writeFile(join(target, 'earlier.json'), reports);

    expect(await second.run('run', 'cases/demo.yaml', '--baseline', 'latest')).toBe(1);
    const output = second.stdout.join('');
    expect(output).toContain('Compared with the baseline');
    expect(output).toContain(
      '▲ tiny-llm  tokensPerSecond: tokens/s fell -50% (200 tok/s → 100 tok/s, limit -15%)',
    );
    expect(output).toContain('1 performance regression(s)');
  });

  it('carries on without a baseline when "latest" finds none, and fails on a path that does not exist', async () => {
    const harness = await cli(good);
    expect(await harness.run('run', 'cases/demo.yaml', '--baseline', 'latest')).toBe(0);
    expect(harness.stdout.join('')).toContain('No baseline found');
    expect(await harness.run('run', 'cases/demo.yaml', '--baseline', 'nowhere/baseline.json')).toBe(
      2,
    );
    expect(harness.stderr.join('')).toContain('Baseline not found: nowhere/baseline.json');
  });
});
