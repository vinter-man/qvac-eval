import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CaseTimeoutError, InfraError, UsageError } from '../src/errors.js';
import type { CaseResult, RunReport } from '../src/report/schema.js';
import { goldenFilePath, saveGolden } from '../src/run/golden.js';
import {
  InterruptedError,
  runSuite,
  type ProgressEvent,
  type RunSettings,
} from '../src/run/execute.js';
import { withTimeout } from '../src/run/timeout.js';
import {
  buildModelCatalog,
  loadConfig,
  loadModelRegistry,
  loadSuite,
  selectModels,
} from '../src/suites/load.js';
import {
  completion,
  createFakeSession,
  hangUntilAborted,
  noMemory,
  type FakeBehavior,
  type FakeSession,
} from './support/fakes.js';
import { makeWorkspace, MODELS_YAML, SUITE_YAML } from './support/workspace.js';

interface Harness {
  root: string;
  events: ProgressEvent[];
  session: FakeSession;
  run: (overrides?: Partial<RunSettings>) => Promise<RunReport>;
}

async function harness(
  behaviors: Record<string, FakeBehavior>,
  options: { suite?: string; models?: string[]; sdk?: string } = {},
): Promise<Harness> {
  const root = await makeWorkspace({
    'models.yaml': MODELS_YAML,
    'suite.yaml': options.suite ?? SUITE_YAML,
    'fixtures/a.wav': 'RIFF',
  });
  const suite = await loadSuite(join(root, 'suite.yaml'));
  const registry = await loadModelRegistry(join(root, 'models.yaml'));
  const models = selectModels(
    options.models,
    suite.definition,
    buildModelCatalog(registry, suite.definition),
  );
  const session = createFakeSession(behaviors, options.sdk);
  const events: ProgressEvent[] = [];
  const config = await loadConfig(undefined);

  return {
    root,
    events,
    session,
    run: (overrides = {}) =>
      runSuite({
        suite,
        models,
        session,
        config,
        repeat: 1,
        device: 'cpu',
        goldenDir: join(root, 'golden'),
        updateGolden: false,
        cwd: root,
        signal: new AbortController().signal,
        createSampler: noMemory,
        environment: {
          node: 'v22.17.0',
          platform: 'linux',
          arch: 'x64',
          cpuCount: 4,
          memoryMb: 16000,
        },
        now: () => new Date('2026-10-29T12:00:00.000Z'),
        onProgress: (event) => events.push(event),
        ...overrides,
      }),
  };
}

const pass: FakeBehavior = {
  complete: (request) =>
    completion(
      request.messages[0]?.content.includes('JSON') || request.messages[0]?.content.includes('{')
        ? '{"ok": true}'
        : 'Paris',
    ),
};

function byId(report: RunReport, modelIndex = 0): Record<string, CaseResult> {
  return Object.fromEntries(
    (report.models[modelIndex]?.cases ?? []).map((testCase) => [testCase.id, testCase]),
  );
}

describe('runSuite', () => {
  it('passes, records metrics and aggregates tokens per second by total tokens over total time', async () => {
    const { run, session } = await harness({
      'tiny-llm': {
        complete: (_request, _signal, call) =>
          call === 0
            ? completion('Paris', { generatedTokens: 20, tokensPerSecond: 100, wallMs: 30 })
            : completion('{"ok": true}', { generatedTokens: 40, tokensPerSecond: 50, wallMs: 90 }),
      },
    });
    const report = await run();

    expect(report.verdict).toBe('pass');
    expect(report.summary).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(report.environment.sdk).toEqual({ name: '@qvac/sdk', version: '0.22.0' });
    const model = report.models[0];
    expect(model?.status).toBe('completed');
    expect(model?.perf?.tokensPerSecond).toBeCloseTo(60, 6);
    expect(model?.perf?.latencyMs).toEqual({ p50: 30, p95: 90 });
    expect(model?.perf?.peakRssMb).toBe(512);
    expect(model?.perf?.loadMs).toBe(120);
    expect(byId(report).capital?.metrics).toMatchObject({ latencyMs: 30, tokensPerSecond: 100 });
    expect(session.calls).toEqual([
      'load:tiny-llm',
      'complete:tiny-llm',
      'complete:tiny-llm',
      'unload:tiny-llm',
    ]);
  });

  it('ignores the rate of runs that are too short to be meaningful', async () => {
    const { run } = await harness({
      'tiny-llm': {
        complete: () =>
          completion('Paris {"ok":true}', { generatedTokens: 3, tokensPerSecond: 9999 }),
      },
    });
    expect((await run()).models[0]?.perf?.tokensPerSecond).toBeUndefined();
  });

  it('marks a case failed and keeps the diff of the expectation', async () => {
    const suite = `
suite: demo
models: [tiny-llm]
cases:
  - { id: translate, kind: completion, input: Translate, expect: { exact: chat } }
`;
    const { run } = await harness(
      { 'tiny-llm': { complete: () => completion('Le chat.') } },
      { suite },
    );
    const report = await run();
    const result = byId(report).translate;
    expect(result?.status).toBe('failed');
    expect(result?.diff).toEqual({ expected: 'chat', actual: 'Le chat.' });
    expect(report.verdict).toBe('fail');
  });

  it('cancels a case that exceeds its timeout and goes on with the next one', async () => {
    let aborted = false;
    const { run } = await harness({
      'tiny-llm': {
        complete: (_request, signal, call) => {
          if (call > 0) return completion('{"ok": true}');
          signal.addEventListener('abort', () => {
            aborted = true;
          });
          return hangUntilAborted(signal);
        },
      },
    });
    const report = await run();
    const cases = byId(report);
    expect(aborted).toBe(true);
    expect(cases.capital).toMatchObject({
      status: 'errored',
      error: { kind: 'timeout', message: 'Timed out after 400 ms' },
    });
    expect(cases.json?.status).toBe('passed');
    expect(report.verdict).toBe('fail');
  });

  it('records an SDK error on one case without stopping the model', async () => {
    const { run } = await harness({
      'tiny-llm': {
        complete: (_request, _signal, call) => {
          if (call === 0) throw new Error('CompletionFailedError: context overflow');
          return completion('{"ok": true}');
        },
      },
    });
    const report = await run();
    expect(byId(report).capital).toMatchObject({
      status: 'errored',
      error: { kind: 'sdk', message: 'CompletionFailedError: context overflow' },
    });
    expect(byId(report).json?.status).toBe('passed');
  });

  it('reports a model that fails to load as an infrastructure error and still unloads it', async () => {
    const { run, session } = await harness(
      {
        'tiny-llm': {
          load: () => {
            throw new Error('download failed: 503');
          },
        },
        'tiny-embed': {
          embed: () => ({
            vectors: [
              [1, 0],
              [0.8, 0.6],
            ],
            wallMs: 5,
          }),
        },
      },
      {
        suite: `
suite: demo
models: [tiny-llm, tiny-embed]
cases:
  - { id: chat, kind: completion, input: Hi }
  - { id: vec, kind: embed, input: [a, b], expect: { cosineMin: 0.5 } }
`,
      },
    );
    const report = await run();
    expect(report.models[0]).toMatchObject({
      status: 'infra-error',
      note: 'model failed to load: download failed: 503',
    });
    expect(report.models[1]?.status).toBe('completed');
    expect(report.verdict).toBe('error');
    expect(session.calls).toContain('unload:tiny-llm');
    expect(session.calls).toContain('unload:tiny-embed');
  });

  it('turns a worker crash during a case into an infrastructure error and unloads in finally', async () => {
    const { run, session } = await harness({
      'tiny-llm': {
        complete: () => {
          throw new InfraError('The QVAC worker failed: socket closed');
        },
      },
    });
    const report = await run();
    expect(report.models[0]).toMatchObject({
      status: 'infra-error',
      note: 'The QVAC worker failed: socket closed',
    });
    expect(session.calls.at(-1)).toBe('unload:tiny-llm');
    expect(report.verdict).toBe('error');
  });

  it('does not let a failing unload hide the results', async () => {
    const { run } = await harness({
      'tiny-llm': {
        ...pass,
        unload: () => {
          throw new Error('worker is gone');
        },
      },
    });
    const report = await run();
    expect(report.models[0]).toMatchObject({
      status: 'completed',
      note: 'unloading the model failed: worker is gone',
    });
    expect(report.verdict).toBe('pass');
  });

  it('fails the load when it exceeds the load timeout', async () => {
    const { run } = await harness({ 'tiny-llm': { load: (signal) => hangUntilAborted(signal) } });
    const config = await loadConfig(undefined);
    const report = await run({
      config: { ...config, timeouts: { ...config.timeouts, loadMs: 30 } },
    });
    expect(report.models[0]?.status).toBe('infra-error');
    expect(report.models[0]?.note).toContain('Timed out after 30 ms');
  });

  it('runs every attempt and requires identical output at temperature 0', async () => {
    const outputs = ['Paris', 'Paris', 'Paris', '{"ok": true}', '{"ok": true}', '{"ok": true}'];
    let index = 0;
    const { run } = await harness({
      'tiny-llm': { complete: () => completion(outputs[index++] ?? '') },
    });
    const report = await run({ repeat: 3 });
    const cases = byId(report);
    expect(cases.capital?.attempts).toBe(3);
    expect(cases.capital?.checks.find((check) => check.name === 'deterministic')?.passed).toBe(
      true,
    );
    expect(report.models[0]?.perf?.latencyMs).toBeDefined();
  });

  it('fails the determinism check when the output drifts between runs', async () => {
    const outputs = ['Paris', 'Paris!', 'Paris'];
    let index = 0;
    const { run } = await harness(
      { 'tiny-llm': { complete: () => completion(outputs[index++ % outputs.length] ?? '') } },
      {
        suite: `
suite: demo
models: [tiny-llm]
defaults: { temperature: 0 }
cases:
  - { id: capital, kind: completion, input: Hi }
`,
      },
    );
    const result = byId(await run({ repeat: 3 })).capital;
    expect(result?.status).toBe('failed');
    expect(result?.checks[0]).toMatchObject({ name: 'deterministic', passed: false });
  });

  it('does not require determinism above temperature 0 but honours an explicit request', async () => {
    const outputs = ['a', 'b', 'c', 'd'];
    let index = 0;
    const suite = `
suite: demo
models: [tiny-llm]
cases:
  - { id: warm, kind: completion, input: Hi, generation: { temperature: 0.8 } }
  - { id: forced, kind: completion, input: Hi, generation: { temperature: 0.8 }, expect: { deterministic: true } }
`;
    const { run } = await harness(
      { 'tiny-llm': { complete: () => completion(outputs[index++] ?? 'e') } },
      { suite },
    );
    const cases = byId(await run({ repeat: 1 }));
    expect(cases.warm).toMatchObject({ status: 'passed', attempts: 1 });
    expect(cases.forced).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('passes the merged generation settings to the runner, case over suite over model', async () => {
    const seen: unknown[] = [];
    const suite = `
suite: demo
models: [tiny-llm]
defaults: { temperature: 0, seed: 7, maxTokens: 16 }
cases:
  - { id: a, kind: completion, input: Hi, generation: { maxTokens: 99 }, responseFormat: json_object }
`;
    const { run } = await harness(
      {
        'tiny-llm': {
          complete: (request) => {
            seen.push(request);
            return completion('{}');
          },
        },
      },
      { suite },
    );
    await run();
    expect(seen[0]).toMatchObject({
      messages: [{ role: 'user', content: 'Hi' }],
      generation: { temperature: 0, seed: 7, maxTokens: 99 },
      responseFormat: 'json_object',
    });
  });

  it('skips a model for which the suite has no cases', async () => {
    const { run } = await harness({ 'tiny-llm': pass }, { models: ['tiny-llm', 'tiny-asr'] });
    const report = await run();
    expect(report.models[1]).toMatchObject({
      status: 'skipped',
      note: 'the suite has no cases for asr models',
    });
    expect(report.verdict).toBe('pass');
  });

  it('scores embeddings and transcriptions', async () => {
    const suite = `
suite: demo
models: [tiny-embed, tiny-asr]
cases:
  - id: vec
    kind: embed
    input: [a, b, c]
    expect: { dims: 2, normalized: true, ranking: [{ closer: [0, 1], than: [0, 2] }] }
  - id: speech
    kind: transcribe
    input: fixtures/a.wav
    expect: { reference: ask not what your country can do, werMax: 0.2, maxRealTimeFactor: 1 }
`;
    const { run } = await harness(
      {
        'tiny-embed': {
          embed: () => ({
            vectors: [
              [1, 0],
              [0.6, 0.8],
              [0, 1],
            ],
            wallMs: 7,
          }),
        },
        'tiny-asr': {
          transcribe: () => ({
            text: 'Ask not what your country can do.',
            wallMs: 90,
            audioMs: 11000,
          }),
        },
      },
      { suite },
    );
    const report = await run();
    expect(report.verdict).toBe('pass');
    expect(byId(report, 0).vec?.metrics?.cosine).toBeCloseTo(0.6, 6);
    expect(byId(report, 0).vec?.output).toBe('3 × 2, norms 1, 1, 1');
    expect(byId(report, 1).speech?.metrics).toMatchObject({
      wer: 0,
      realTimeFactor: 90 / 11000,
    });
  });

  it('refuses to start when an audio fixture is missing', async () => {
    const suite = `
suite: demo
models: [tiny-asr]
cases:
  - { id: speech, kind: transcribe, input: fixtures/missing.wav }
`;
    const { run, session } = await harness({ 'tiny-asr': {} }, { suite });
    await expect(run()).rejects.toThrow(UsageError);
    expect(session.calls).toEqual([]);
  });

  it('stops on interruption after unloading the model', async () => {
    const controller = new AbortController();
    const { run, session } = await harness({
      'tiny-llm': {
        complete: (_request, signal) => {
          controller.abort();
          return hangUntilAborted(signal);
        },
      },
    });
    await expect(run({ signal: controller.signal })).rejects.toThrow(InterruptedError);
    expect(session.calls.at(-1)).toBe('unload:tiny-llm');
  });
});

describe('golden outputs', () => {
  const suite = `
suite: demo
models: [tiny-llm]
cases:
  - { id: capital, kind: completion, input: Capital of France?, expect: { contains: [Paris], golden: true } }
  - { id: plain, kind: completion, input: Say Paris, expect: { contains: [Paris] } }
`;

  it('marks a case regressed when the output drifts from the golden', async () => {
    const { run, root } = await harness(
      {
        'tiny-llm': {
          complete: () => completion('Paris is the capital city of the French Republic'),
        },
      },
      { suite },
    );
    await saveGolden(join(root, 'golden'), {
      schemaVersion: 1,
      suite: 'demo',
      model: 'tiny-llm',
      sdk: '0.21.1',
      recordedAt: '2026-10-01T00:00:00.000Z',
      cases: { capital: { kind: 'completion', text: 'Paris.' } },
    });
    const report = await run();
    const result = byId(report).capital;
    expect(result?.status).toBe('regressed');
    expect(result?.regressions[0]?.message).toContain('golden recorded with SDK 0.21.1');
    expect(result?.diff?.expected).toBe('Paris.');
    expect(byId(report).plain?.status).toBe('passed');
    expect(report.models[0]?.goldenSdk).toBe('0.21.1');
    expect(report.verdict).toBe('fail');
  });

  it('accepts output within the tolerance and notes the similarity', async () => {
    const { run, root } = await harness(
      { 'tiny-llm': { complete: () => completion('The capital of France is Paris!') } },
      { suite },
    );
    await saveGolden(join(root, 'golden'), {
      schemaVersion: 1,
      suite: 'demo',
      model: 'tiny-llm',
      sdk: '0.22.0',
      recordedAt: '2026-10-01T00:00:00.000Z',
      cases: { capital: { kind: 'completion', text: 'The capital of France is Paris.' } },
    });
    const result = byId(await run()).capital;
    expect(result?.status).toBe('passed');
    expect(result?.metrics?.goldenSimilarity).toBeCloseTo(1 - 1 / 31, 6);
  });

  it('runs without a golden file and says nothing about it', async () => {
    const { run } = await harness(
      { 'tiny-llm': { complete: () => completion('Paris') } },
      { suite },
    );
    const report = await run();
    expect(report.verdict).toBe('pass');
    expect(report.models[0]?.goldenSdk).toBeUndefined();
  });

  it('records goldens only for the cases that ask for them and passed their checks', async () => {
    const two = `
suite: demo
models: [tiny-llm]
cases:
  - { id: good, kind: completion, input: Hi, expect: { contains: [Paris], golden: true } }
  - { id: bad, kind: completion, input: Hi, expect: { contains: [Lyon], golden: true } }
  - { id: unasked, kind: completion, input: Hi }
`;
    const { run, root, events } = await harness(
      { 'tiny-llm': { complete: () => completion('Paris') } },
      { suite: two },
    );
    const report = await run({ updateGolden: true });
    const written = JSON.parse(
      await readFile(goldenFilePath(join(root, 'golden'), 'tiny-llm', '0.22.0', 'demo'), 'utf8'),
    ) as { cases: Record<string, unknown> };
    expect(Object.keys(written.cases)).toEqual(['good']);
    expect(events.find((event) => event.type === 'golden-saved')).toMatchObject({
      written: 1,
      skipped: ['bad'],
    });
    expect(report.models[0]?.goldenSdk).toBeUndefined();
  });

  it('does not compare with the old golden while it is being updated', async () => {
    const { run, root } = await harness(
      { 'tiny-llm': { complete: () => completion('Paris, obviously') } },
      { suite },
    );
    await saveGolden(join(root, 'golden'), {
      schemaVersion: 1,
      suite: 'demo',
      model: 'tiny-llm',
      sdk: '0.22.0',
      recordedAt: '2026-10-01T00:00:00.000Z',
      cases: { capital: { kind: 'completion', text: 'Lyon' } },
    });
    const report = await run({ updateGolden: true });
    expect(report.verdict).toBe('pass');
    await access(goldenFilePath(join(root, 'golden'), 'tiny-llm', '0.22.0', 'demo'));
  });
});

describe('withTimeout', () => {
  it('resolves with the result and clears its timers', async () => {
    const controller = new AbortController();
    await expect(withTimeout(1000, controller.signal, () => Promise.resolve(42))).resolves.toBe(42);
  });

  it('aborts the work and reports a timeout, not the error the cancelled work threw', async () => {
    const controller = new AbortController();
    const result = withTimeout(20, controller.signal, (signal) => hangUntilAborted(signal));
    await expect(result).rejects.toBeInstanceOf(CaseTimeoutError);
  });

  it('gives up with an infrastructure error when the work ignores the cancel', async () => {
    const controller = new AbortController();
    const result = withTimeout(
      10,
      controller.signal,
      () => new Promise<never>(() => undefined),
      20,
    );
    await expect(result).rejects.toThrow('did not stop 20 ms after the request was cancelled');
  });

  it('forwards an interruption from the parent signal', async () => {
    const parent = new AbortController();
    const result = withTimeout(5000, parent.signal, (signal) => hangUntilAborted(signal));
    parent.abort(new Error('stop'));
    await expect(result).rejects.toThrow('inference was cancelled');
  });

  it('passes through errors from the work itself', async () => {
    const controller = new AbortController();
    await expect(
      withTimeout(1000, controller.signal, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});
