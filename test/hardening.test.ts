import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { QvacRunner } from '../src/adapter/qvac-runner.js';
import type { QvacSdkModule } from '../src/adapter/sdk-api.js';
import { UsageError } from '../src/errors.js';
import { validateAgainstSchema } from '../src/metrics/json-schema.js';
import { expectPlan, parsePlan } from '../src/report/plan.js';
import { buildView } from '../src/report/view.js';
import { formatGolden, saveGolden } from '../src/run/golden.js';
import { runSuite } from '../src/run/execute.js';
import { withDeadline, withTimeout } from '../src/run/timeout.js';
import { loadConfig, loadSuite } from '../src/suites/load.js';
import { completion, createFakeSession, noMemory } from './support/fakes.js';
import { makeCase, makeModel, makeReport } from './support/reports.js';
import { makeWorkspace, MODELS_YAML } from './support/workspace.js';

describe('JSON Schema checks', () => {
  it('rejects a missing required key even when the schema lists no properties', () => {
    const schema = { type: 'object', required: ['ok', 'name'] };
    expect(validateAgainstSchema({ ok: true }, schema).ok).toBe(false);
    expect(validateAgainstSchema({ ok: true, name: 'a' }, schema).ok).toBe(true);
  });

  it('checks required keys of nested objects, array items and alternatives', () => {
    const nested = { type: 'object', properties: { a: { type: 'object', required: ['b'] } } };
    expect(validateAgainstSchema({ a: {} }, nested).ok).toBe(false);
    expect(validateAgainstSchema({ a: { b: 1 } }, nested).ok).toBe(true);
    const items = { type: 'array', items: { type: 'object', required: ['k'] } };
    expect(validateAgainstSchema([{}], items).ok).toBe(false);
    const either = { anyOf: [{ type: 'object', required: ['a'] }, { type: 'string' }] };
    expect(validateAgainstSchema({}, either).ok).toBe(false);
    expect(validateAgainstSchema('text', either).ok).toBe(true);
  });

  it('does not mistake a property that is named "required" for the keyword', () => {
    const schema = { type: 'object', properties: { required: { type: 'boolean' } } };
    expect(validateAgainstSchema({ required: true }, schema).ok).toBe(true);
    expect(validateAgainstSchema({ required: 'x' }, schema).ok).toBe(false);
    expect(validateAgainstSchema({}, schema).ok).toBe(true);
  });
});

describe('golden files keep text as written', () => {
  it('never rewrites an array that appears inside a string', () => {
    const text = formatGolden({
      schemaVersion: 1,
      suite: 's',
      model: 'm',
      sdk: '0.22.0',
      recordedAt: '2026-10-29T10:00:00.000Z',
      cases: {
        a: { kind: 'completion', text: 'Answer: [ 1,\n 2 ]' },
        e: {
          kind: 'embed',
          vectors: [
            [0.1, -0.2],
            [0.3, 0.4],
          ],
        },
      },
    });
    const parsed = JSON.parse(text) as {
      cases: { a: { text: string }; e: { vectors: number[][] } };
    };
    expect(parsed.cases.a.text).toBe('Answer: [ 1,\n 2 ]');
    expect(parsed.cases.e.vectors).toEqual([
      [0.1, -0.2],
      [0.3, 0.4],
    ]);
    expect(text).toContain('[0.1, -0.2],');
  });
});

describe('withTimeout and withDeadline', () => {
  it('gives up on work that ignores a cancel that was already requested', async () => {
    const parent = new AbortController();
    parent.abort(new Error('stop'));
    const result = withTimeout(5000, parent.signal, () => new Promise<never>(() => undefined), 20);
    await expect(result).rejects.toThrow('did not stop 20 ms after the request was cancelled');
  });

  it('rejects when the awaited work outlives its deadline and passes the result otherwise', async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, 'Closing')).resolves.toBe(7);
    await expect(
      withDeadline(new Promise<never>(() => undefined), 20, 'Closing the SDK'),
    ).rejects.toThrow('Closing the SDK did not finish within 20 ms');
    await expect(withDeadline(Promise.reject(new Error('boom')), 1000, 'Closing')).rejects.toThrow(
      'boom',
    );
  });
});

describe('the engine', () => {
  async function engine(suite: string, behavior: Parameters<typeof createFakeSession>[0]) {
    const root = await makeWorkspace({ 'models.yaml': MODELS_YAML, 'suite.yaml': suite });
    const loaded = await loadSuite(join(root, 'suite.yaml'));
    const session = createFakeSession(behavior);
    const config = await loadConfig(undefined);
    return {
      root,
      session,
      run: (models: string[], overrides: { minSimilarity?: number } = {}) =>
        runSuite({
          suite: loaded,
          models: models.map((id) => ({
            id,
            kind: id.includes('llm') ? 'llm' : 'embedding',
            source: id.toUpperCase(),
            config: {},
            generation: {},
          })),
          session,
          config: {
            ...config,
            golden: { ...config.golden, ...overrides },
          },
          repeat: 1,
          device: 'cpu',
          goldenDir: join(root, 'golden'),
          updateGolden: false,
          cwd: root,
          signal: new AbortController().signal,
          createSampler: noMemory,
          environment: { node: 'v22', platform: 'linux', arch: 'x64', cpuCount: 4, memoryMb: 1 },
          now: () => new Date('2026-10-29T12:00:00.000Z'),
          onProgress: () => undefined,
        }),
    };
  }

  const suite = `
suite: g
cases:
  - { id: a, kind: completion, input: Hi, expect: { golden: true } }
`;

  it('refuses a run in which no model has a case', async () => {
    const { run, session } = await engine(suite, { 'tiny-embed': {} });
    await expect(run(['tiny-embed'])).rejects.toThrow(UsageError);
    expect(session.calls).toEqual([]);
  });

  it('reads the golden tolerance from the config when the case does not set one', async () => {
    const harness = await engine(suite, {
      'tiny-llm': { complete: () => completion('The capital of France is Paris!') },
    });
    await saveGolden(join(harness.root, 'golden'), {
      schemaVersion: 1,
      suite: 'g',
      model: 'tiny-llm',
      sdk: '0.22.0',
      recordedAt: '2026-10-01T00:00:00.000Z',
      cases: { a: { kind: 'completion', text: 'The capital of France is Paris.' } },
    });
    expect((await harness.run(['tiny-llm'])).models[0]?.cases[0]?.status).toBe('passed');
    expect(
      (await harness.run(['tiny-llm'], { minSimilarity: 0.99 })).models[0]?.cases[0]?.status,
    ).toBe('regressed');
  });

  it('says whether a golden was compared or was missing', async () => {
    const harness = await engine(suite, { 'tiny-llm': { complete: () => completion('Paris') } });
    const missing = await harness.run(['tiny-llm']);
    expect(missing.models[0]?.cases[0]?.golden).toBe('missing');
    expect(buildView(missing).comparedAgainst).toBe(
      'Nothing was compared: there is no golden output and no baseline, so only the expectations of the cases were checked. 1 case asks for a golden output that is not recorded.',
    );
  });

  it('does not wait for ever for a model that will not unload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const harness = await engine(suite, {
        'tiny-llm': {
          complete: () => completion('Paris'),
          unload: () => new Promise<void>(() => undefined),
        },
      });
      let report: Awaited<ReturnType<typeof harness.run>> | undefined;
      const pending = harness.run(['tiny-llm']).then((result) => (report = result));
      for (let turn = 0; turn < 200 && report === undefined; turn += 1) {
        await vi.advanceTimersByTimeAsync(1000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await pending;
      expect(report?.models[0]?.note).toBe(
        'unloading the model failed: Unloading the model did not finish within 30000 ms',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('QvacRunner', () => {
  it('leaves no unhandled rejection when the event stream fails while the final result rejects', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const sdk = {
        loadModel: () => Object.assign(Promise.resolve('m'), { requestId: 'r' }),
        cancel: () => Promise.resolve(),
        completion: () => ({
          requestId: 'c',
          events: (async function* () {
            await Promise.resolve();
            yield { type: 'contentDelta' };
            throw new Error('worker died');
          })(),
          final: Promise.reject(new Error('worker died')),
        }),
      } as unknown as QvacSdkModule;
      const runner = new QvacRunner(sdk, { device: 'cpu' });
      await runner.load(
        { id: 'a', kind: 'llm', source: 'https://x/m.gguf', config: {}, generation: {} },
        new AbortController().signal,
      );
      await expect(
        runner.complete({ messages: [], generation: {} }, new AbortController().signal),
      ).rejects.toThrow('worker died');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('expectPlan', () => {
  const plan = parsePlan(
    JSON.stringify({
      include: [
        {
          model: 'a',
          kind: 'llm',
          source: 'A',
          sdks: ['0.22.0', '0.21.1'],
          runner: 'ubuntu-24.04',
        },
        {
          model: 'b',
          kind: 'embedding',
          source: 'B',
          sdks: ['0.22.0', '0.21.1'],
          runner: 'ubuntu-24.04',
        },
        { model: 'a', kind: 'llm', source: 'A', sdks: ['0.22.0'], runner: 'macos-15' },
      ],
    }),
    'plan.json',
  );
  const complete = (sdk: string, ids: string[]) =>
    makeReport(
      ids.map((id) => makeModel(id, [makeCase('x')])),
      { sdk },
    );

  it('leaves a complete set of reports alone', () => {
    const groups = [complete('0.21.1', ['a', 'b']), complete('0.22.0', ['a', 'b'])];
    expect(expectPlan(groups, plan, 'ubuntu-24.04')).toEqual(groups);
  });

  it('turns a job that never reported into an infrastructure error and fails the verdict', () => {
    const [group] = expectPlan(
      [complete('0.21.1', ['a']), complete('0.22.0', ['a', 'b'])],
      plan,
      'ubuntu-24.04',
    );
    expect(group?.models[1]).toMatchObject({
      model: { id: 'b', kind: 'embedding', source: 'B' },
      status: 'infra-error',
      note: 'no report arrived from the job of b on SDK 0.21.1: it failed before it could run',
    });
    expect(group?.verdict).toBe('error');
  });

  it('adds a whole SDK version that no job reported, so a comparison cannot silently shrink', () => {
    const groups = expectPlan([complete('0.22.0', ['a', 'b'])], plan, 'ubuntu-24.04');
    expect(groups.map((group) => group.environment.sdk.version)).toEqual(['0.21.1', '0.22.0']);
    expect(groups[0]?.models.map((run) => run.status)).toEqual(['infra-error', 'infra-error']);
    expect(groups[0]?.baseline).toBeUndefined();
  });

  it('looks only at the jobs of its own runner', () => {
    const groups = expectPlan([complete('0.22.0', ['a'])], plan, 'macos-15');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.verdict).toBe('pass');
  });

  it('rejects a plan that is not what "matrix" prints', () => {
    expect(() => parsePlan('nope', 'plan.json')).toThrow('not valid JSON');
    expect(() => parsePlan('{"include": [{"model": 1}]}', 'plan.json')).toThrow(UsageError);
  });
});
