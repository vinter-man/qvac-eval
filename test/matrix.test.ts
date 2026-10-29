import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { NpmRunner } from '../src/adapter/sdk-loader.js';
import type { RunnerSession } from '../src/adapter/types.js';
import type { CliDeps } from '../src/cli/deps.js';
import { main } from '../src/cli/main.js';
import { noMemory } from './support/fakes.js';
import { makeWorkspace } from './support/workspace.js';

const MODELS = `
models:
  tiny-llm: { kind: llm, source: TINY_LLM }
  other-llm: { kind: llm, source: OTHER_LLM }
  tiny-embed: { kind: embedding, source: TINY_EMBED }
`;

const SUITE = `
suite: mixed
models: [tiny-llm, tiny-embed]
cases:
  - { id: chat, kind: completion, input: Hi }
  - { id: only-other, kind: completion, input: Hi, models: [other-llm] }
`;

async function plan(argv: string[], npm?: NpmRunner) {
  const cwd = await makeWorkspace({ 'models.yaml': MODELS, 'cases/mixed.yaml': SUITE });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const asked: string[] = [];
  const deps: CliDeps = {
    cwd,
    env: {},
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
    now: () => new Date(),
    packageRoot: resolve(import.meta.dirname, '..'),
    signal: new AbortController().signal,
    createSampler: noMemory,
    openSession: (): Promise<RunnerSession> => Promise.reject(new Error('not used')),
    npm:
      npm ??
      ((args) => {
        asked.push(args.join(' '));
        const spec = args[1] ?? '';
        const requested = spec.slice(spec.lastIndexOf('@') + 1);
        return Promise.resolve(`"${requested === 'latest' ? '0.22.0' : requested}"\n`);
      }),
  };
  const code = await main(['matrix', 'cases/mixed.yaml', ...argv], deps);
  return { code, stdout: stdout.join(''), stderr: stderr.join(''), asked };
}

describe('qvac-eval matrix', () => {
  it('lists one job per model, resolving "latest" to an exact version and dropping models without cases', async () => {
    const result = await plan([]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      suite: 'mixed',
      compare: false,
      sdks: ['0.22.0'],
      runners: ['ubuntu-24.04'],
      include: [
        { model: 'tiny-llm', kind: 'llm', cases: 1, sdks: ['0.22.0'], runner: 'ubuntu-24.04' },
      ],
    });
    expect(result.stderr).toContain(
      'note: tiny-embed is left out, the suite has no embedding cases',
    );
  });

  it('keeps the SDK versions of a comparison in one job per model and runner, so they share a machine', async () => {
    const result = await plan([
      '--models',
      'tiny-llm,other-llm',
      '--sdk',
      'latest,0.21.1',
      '--runners',
      'ubuntu-24.04,macos-15',
    ]);
    const parsed = JSON.parse(result.stdout) as {
      compare: boolean;
      sdks: string[];
      include: { model: string; sdks: string[]; runner: string }[];
    };
    expect(parsed.compare).toBe(true);
    expect(parsed.sdks).toEqual(['0.22.0', '0.21.1']);
    expect(parsed.include).toHaveLength(2 * 2);
    expect(parsed.include[0]).toEqual(
      expect.objectContaining({
        model: 'tiny-llm',
        sdks: ['0.22.0', '0.21.1'],
        runner: 'ubuntu-24.04',
      }),
    );
    expect(result.asked).toContain('view @qvac/sdk@0.21.1 version --json');
  });

  it('collapses the same version given twice and refuses more than two', async () => {
    const same = await plan(['--sdk', 'latest,0.22.0']);
    expect(JSON.parse(same.stdout)).toMatchObject({ compare: false, sdks: ['0.22.0'] });
    const many = await plan(['--sdk', '0.20.1,0.21.1,0.22.0']);
    expect(many.code).toBe(2);
    expect(many.stderr).toContain('At most two SDK versions');
  });

  it('fails with exit code 2 when no model fits the suite, when a model is unknown or when the version does not exist', async () => {
    const none = await plan(['--models', 'tiny-embed']);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('None of the models has a case');
    expect((await plan(['--models', 'ghost'])).code).toBe(2);
    const missing = await plan(['--sdk', '9.9.9'], () =>
      Promise.reject(new Error('E404 No match found for version 9.9.9')),
    );
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('E404');
  });
});
