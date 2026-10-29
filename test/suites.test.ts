import { access, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../src/errors.js';
import {
  buildModelCatalog,
  casesForModel,
  loadConfig,
  loadModelRegistry,
  loadSuite,
  selectModels,
} from '../src/suites/load.js';
import { makeWorkspace, MODELS_YAML, SUITE_YAML } from './support/workspace.js';

function thrown(action: () => unknown): UsageError {
  try {
    action();
  } catch (error) {
    if (error instanceof UsageError) return error;
    throw error;
  }
  throw new Error('Expected the call to throw');
}

async function suiteError(yaml: string): Promise<UsageError> {
  const root = await makeWorkspace({ 'suite.yaml': yaml });
  try {
    await loadSuite(join(root, 'suite.yaml'));
  } catch (error) {
    if (error instanceof UsageError) return error;
    throw error;
  }
  throw new Error('Expected loadSuite to throw');
}

const repository = resolve(import.meta.dirname, '..');

describe('loadSuite', () => {
  it('parses a valid suite and keeps the defaults', async () => {
    const root = await makeWorkspace({ 'suite.yaml': SUITE_YAML });
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    expect(definition.suite).toBe('demo');
    expect(definition.defaults).toEqual({ temperature: 0, seed: 1, maxTokens: 16, timeoutMs: 400 });
    expect(definition.cases.map((testCase) => testCase.id)).toEqual(['capital', 'json']);
  });

  it('accepts a message array as completion input and YAML anchors', async () => {
    const root = await makeWorkspace({
      'suite.yaml': `
suite: anchors
cases:
  - id: a
    kind: completion
    input:
      - { role: system, content: Be brief }
      - { role: user, content: Hi }
    responseFormat:
      jsonSchema: &schema { type: object }
    expect:
      jsonSchema: *schema
`,
    });
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    expect(definition.cases[0]).toMatchObject({ expect: { jsonSchema: { type: 'object' } } });
  });

  it('points at the exact path of an unknown key', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - id: a
    kind: completion
    input: Hi
    expect:
      contain: [x]
`);
    expect(error.message).toContain('does not match the expected format');
    expect(error.details.join('\n')).toContain('cases[0].expect');
    expect(error.details.join('\n')).toContain('contain');
  });

  it('rejects an unknown case kind', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - { id: a, kind: translate, input: Hi }
`);
    expect(error.details.join('\n')).toContain('cases[0]');
  });

  it('rejects duplicate case ids', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - { id: a, kind: completion, input: Hi }
  - { id: a, kind: completion, input: Hello }
`);
    expect(error.details).toEqual(['cases: duplicate case id "a"']);
  });

  it('rejects invalid YAML with the line number', async () => {
    const error = await suiteError('suite: x\ncases: [unclosed\n');
    expect(error.message).toContain('not valid YAML');
    expect(error.details[0]).toMatch(/^line \d+/u);
  });

  it('rejects duplicate YAML keys', async () => {
    const error = await suiteError(
      'suite: x\nsuite: y\ncases:\n  - { id: a, kind: completion, input: Hi }\n',
    );
    expect(error.message).toContain('not valid YAML');
  });

  it('rejects a regex that does not compile', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - { id: a, kind: completion, input: Hi, expect: { regex: "(" } }
`);
    expect(error.details[0]).toContain('cases[0].expect.regex');
  });

  it('rejects a JSON Schema that cannot be compiled', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - { id: a, kind: completion, input: Hi, expect: { jsonSchema: { type: banana } } }
`);
    expect(error.details[0]).toContain('cases[0].expect.jsonSchema');
  });

  it('rejects pairwise embedding checks on a single input', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - { id: a, kind: embed, input: [one], expect: { cosineMin: 0.5 } }
`);
    expect(error.details[0]).toContain('two inputs are needed');
  });

  it('rejects ranking indexes outside the inputs', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - id: a
    kind: embed
    input: [one, two]
    expect:
      ranking: [{ closer: [0, 1], than: [0, 2] }]
`);
    expect(error.details[0]).toContain('index 2 is outside the 2 inputs');
  });

  it('rejects werMax without a reference', async () => {
    const error = await suiteError(`
suite: bad
cases:
  - { id: a, kind: transcribe, input: a.wav, expect: { werMax: 0.1 } }
`);
    expect(error.details[0]).toContain('werMax needs a reference');
  });

  it('reports a missing file plainly', async () => {
    await expect(loadSuite('/nonexistent/suite.yaml')).rejects.toThrow('file not found');
  });
});

describe('models', () => {
  it('resolves ids from the registry and from the suite itself', async () => {
    const root = await makeWorkspace({
      'models.yaml': MODELS_YAML,
      'suite.yaml': `
suite: inline
models:
  - tiny-llm
  - id: custom
    kind: llm
    source: https://example.com/model.gguf
    generation: { reasoningBudget: 0 }
cases:
  - { id: a, kind: completion, input: Hi }
`,
    });
    const registry = await loadModelRegistry(join(root, 'models.yaml'));
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    const catalog = buildModelCatalog(registry, definition);
    const selected = selectModels(undefined, definition, catalog);
    expect(selected.map((model) => model.id)).toEqual(['tiny-llm', 'custom']);
    expect(selected[1]).toMatchObject({
      source: 'https://example.com/model.gguf',
      generation: { reasoningBudget: 0 },
    });
    expect(selectModels(['tiny-asr'], definition, catalog)[0]?.kind).toBe('asr');
  });

  it('lists the known models when an id is unknown', async () => {
    const root = await makeWorkspace({ 'models.yaml': MODELS_YAML, 'suite.yaml': SUITE_YAML });
    const registry = await loadModelRegistry(join(root, 'models.yaml'));
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    const catalog = buildModelCatalog(registry, definition);
    const error = thrown(() => selectModels(['nope'], definition, catalog));
    expect(error.message).toBe('Unknown model "nope"');
    expect(error.details[0]).toContain('tiny-llm, tiny-embed, tiny-asr');
  });

  it('refuses a model listed twice and a suite with no models', async () => {
    const root = await makeWorkspace({
      'models.yaml': MODELS_YAML,
      'suite.yaml': `suite: s\ncases:\n  - { id: a, kind: completion, input: Hi }\n`,
    });
    const registry = await loadModelRegistry(join(root, 'models.yaml'));
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    const catalog = buildModelCatalog(registry, definition);
    expect(() => selectModels(['tiny-llm', 'tiny-llm'], definition, catalog)).toThrow(
      'listed twice',
    );
    expect(() => selectModels(undefined, definition, catalog)).toThrow('No models to run');
  });

  it('refuses an inline model that shadows a registry model', async () => {
    const root = await makeWorkspace({
      'models.yaml': MODELS_YAML,
      'suite.yaml': `
suite: s
models:
  - { id: tiny-llm, kind: llm, source: X }
cases:
  - { id: a, kind: completion, input: Hi }
`,
    });
    const registry = await loadModelRegistry(join(root, 'models.yaml'));
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    expect(() => buildModelCatalog(registry, definition)).toThrow(
      'both in the model registry and in the suite',
    );
  });

  it('picks the cases a model can serve', async () => {
    const root = await makeWorkspace({
      'models.yaml': MODELS_YAML,
      'suite.yaml': `
suite: mixed
cases:
  - { id: chat, kind: completion, input: Hi }
  - { id: only-asr-model, kind: transcribe, input: a.wav, models: [tiny-asr] }
  - { id: embed-all, kind: embed, input: [a] }
  - { id: chat-big, kind: completion, input: Hi, models: [other] }
`,
    });
    const registry = await loadModelRegistry(join(root, 'models.yaml'));
    const { definition } = await loadSuite(join(root, 'suite.yaml'));
    const catalog = buildModelCatalog(registry, definition);
    const ids = (id: string) => {
      const model = catalog.get(id);
      if (model === undefined) throw new Error(`missing ${id}`);
      return casesForModel(definition, model).map((testCase) => testCase.id);
    };
    expect(ids('tiny-llm')).toEqual(['chat']);
    expect(ids('tiny-embed')).toEqual(['embed-all']);
    expect(ids('tiny-asr')).toEqual(['only-asr-model']);
  });
});

describe('config', () => {
  it('uses the defaults when there is no file', async () => {
    const config = await loadConfig(undefined);
    expect(config.thresholds.tokensPerSecondDropPct).toBe(15);
    expect(config.thresholds.werIncrease).toBe(0.05);
    expect(config.golden.dir).toBe('golden');
  });

  it('merges a partial file over the defaults and rejects unknown keys', async () => {
    const root = await makeWorkspace({
      'a.yaml': 'thresholds:\n  tokensPerSecondDropPct: 30\n',
      'b.yaml': 'thresholds:\n  tokensPerSecDrop: 30\n',
    });
    const partial = await loadConfig(join(root, 'a.yaml'));
    expect(partial.thresholds.tokensPerSecondDropPct).toBe(30);
    expect(partial.thresholds.cosineDrop).toBe(0.02);
    await expect(loadConfig(join(root, 'b.yaml'))).rejects.toThrow(UsageError);
  });
});

describe('the config shipped in this repository', () => {
  it('spells out exactly the defaults of the schema', async () => {
    expect(await loadConfig(join(repository, 'qvac-eval.config.yaml'))).toEqual(
      await loadConfig(undefined),
    );
  });
});

describe('the suites shipped in this repository', () => {
  it('are valid, use known models and point at real fixtures', async () => {
    const registry = await loadModelRegistry(join(repository, 'models.yaml'));
    await loadConfig(join(repository, 'qvac-eval.config.yaml'));
    const files = (await readdir(join(repository, 'cases'))).filter((name) =>
      name.endsWith('.yaml'),
    );
    expect(files.sort()).toEqual([
      'completion.yaml',
      'embed.yaml',
      'hard.yaml',
      'smoke.yaml',
      'transcribe.yaml',
    ]);

    for (const file of files) {
      const suite = await loadSuite(join(repository, 'cases', file));
      const catalog = buildModelCatalog(registry, suite.definition);
      const models = selectModels(undefined, suite.definition, catalog);
      for (const model of models) {
        expect(
          casesForModel(suite.definition, model).length,
          `${file}: ${model.id}`,
        ).toBeGreaterThan(0);
      }
      for (const testCase of suite.definition.cases) {
        if (testCase.kind === 'transcribe') await access(join(repository, testCase.input));
      }
    }
  });
});
