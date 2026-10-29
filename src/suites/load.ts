import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';
import type { z } from 'zod';

import { describeError, isNotFound, UsageError } from '../errors.js';
import { assertCompilableSchema } from '../metrics/json-schema.js';
import {
  configSchema,
  modelRegistrySchema,
  suiteSchema,
  type CaseDefinition,
  type CompletionCase,
  type EmbedCase,
  type EvalConfig,
  type Generation,
  type InlineModel,
  type ModelDefinition,
  type ModelKind,
  type ModelRegistry,
  type SuiteDefinition,
  type TranscribeCase,
} from './schema.js';

export interface LoadedSuite {
  file: string;
  definition: SuiteDefinition;
}

export interface ResolvedModel {
  id: string;
  kind: ModelKind;
  source: string;
  license?: string;
  sizeMb?: number;
  config: Record<string, unknown>;
  generation: Generation;
}

const caseKindByModelKind = {
  llm: 'completion',
  embedding: 'embed',
  asr: 'transcribe',
} as const satisfies Record<ModelKind, CaseDefinition['kind']>;

function formatPath(path: readonly PropertyKey[]): string {
  let text = '';
  for (const segment of path) {
    text +=
      typeof segment === 'number' ? `[${segment}]` : `${text === '' ? '' : '.'}${String(segment)}`;
  }
  return text === '' ? '(root)' : text;
}

async function parseYamlFile<S extends z.ZodType>(file: string, schema: S): Promise<z.output<S>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const reason = isNotFound(error) ? 'file not found' : String(error);
    throw new UsageError(`Cannot read ${file}: ${reason}`);
  }

  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new UsageError(
      `${file} is not valid YAML`,
      document.errors.map((error) => {
        const position = error.linePos?.[0];
        return position === undefined ? error.message : `line ${position.line}: ${error.message}`;
      }),
    );
  }

  const result = schema.safeParse(document.toJS());
  if (!result.success) {
    throw new UsageError(
      `${file} does not match the expected format`,
      result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
    );
  }
  return result.data;
}

function assertUniqueCaseIds(file: string, definition: SuiteDefinition): void {
  const seen = new Set<string>();
  for (const testCase of definition.cases) {
    if (seen.has(testCase.id)) {
      throw new UsageError(`${file} does not match the expected format`, [
        `cases: duplicate case id "${testCase.id}"`,
      ]);
    }
    seen.add(testCase.id);
  }
}

function completionProblems(testCase: CompletionCase, at: string): string[] {
  const problems: string[] = [];
  const schemas = [
    ['expect.jsonSchema', testCase.expect.jsonSchema],
    [
      'responseFormat.jsonSchema',
      typeof testCase.responseFormat === 'object' ? testCase.responseFormat.jsonSchema : undefined,
    ],
  ] as const;
  for (const [field, schema] of schemas) {
    if (schema === undefined) continue;
    const verdict = assertCompilableSchema(schema);
    if (!verdict.ok) problems.push(`${at}.${field}: invalid JSON Schema (${verdict.message})`);
  }
  if (testCase.expect.regex !== undefined) {
    try {
      new RegExp(testCase.expect.regex, 'u');
    } catch (error) {
      problems.push(`${at}.expect.regex: ${describeError(error)}`);
    }
  }
  return problems;
}

function embedProblems(testCase: EmbedCase, at: string): string[] {
  const problems: string[] = [];
  const { expect, input } = testCase;
  const pairwise = expect.cosineMin !== undefined || expect.cosineMax !== undefined;
  if (pairwise && input.length < 2) {
    problems.push(
      `${at}.expect: cosineMin and cosineMax compare inputs 0 and 1, so two inputs are needed`,
    );
  }
  for (const [ruleIndex, rule] of (expect.ranking ?? []).entries()) {
    const outside = [...rule.closer, ...rule.than].filter((position) => position >= input.length);
    if (outside.length > 0) {
      problems.push(
        `${at}.expect.ranking[${ruleIndex}]: index ${outside.join(', ')} is outside the ${input.length} inputs`,
      );
    }
  }
  return problems;
}

function transcribeProblems(testCase: TranscribeCase, at: string): string[] {
  if (testCase.expect.werMax !== undefined && testCase.expect.reference === undefined) {
    return [`${at}.expect: werMax needs a reference text to compare with`];
  }
  return [];
}

function assertValidCases(file: string, definition: SuiteDefinition): void {
  const problems = definition.cases.flatMap((testCase, index) => {
    const at = `cases[${index}]`;
    switch (testCase.kind) {
      case 'completion':
        return completionProblems(testCase, at);
      case 'embed':
        return embedProblems(testCase, at);
      case 'transcribe':
        return transcribeProblems(testCase, at);
    }
  });
  if (problems.length > 0) throw new UsageError(`${file} contains cases that cannot run`, problems);
}

export async function loadSuite(file: string): Promise<LoadedSuite> {
  const definition = await parseYamlFile(file, suiteSchema);
  assertUniqueCaseIds(file, definition);
  assertValidCases(file, definition);
  return { file, definition };
}

export async function loadModelRegistry(file: string): Promise<ModelRegistry> {
  return parseYamlFile(file, modelRegistrySchema);
}

export async function loadConfig(file: string | undefined): Promise<EvalConfig> {
  if (file === undefined) return configSchema.parse({});
  return parseYamlFile(file, configSchema);
}

function toResolved(id: string, definition: ModelDefinition): ResolvedModel {
  return {
    id,
    kind: definition.kind,
    source: definition.source,
    ...(definition.license === undefined ? {} : { license: definition.license }),
    ...(definition.sizeMb === undefined ? {} : { sizeMb: definition.sizeMb }),
    config: definition.config ?? {},
    generation: definition.generation ?? {},
  };
}

function inlineModels(suite: SuiteDefinition): InlineModel[] {
  return (suite.models ?? []).filter((entry): entry is InlineModel => typeof entry === 'object');
}

export function buildModelCatalog(
  registry: ModelRegistry,
  suite: SuiteDefinition,
): Map<string, ResolvedModel> {
  const catalog = new Map<string, ResolvedModel>();
  for (const [id, definition] of Object.entries(registry.models)) {
    catalog.set(id, toResolved(id, definition));
  }
  for (const { id, ...definition } of inlineModels(suite)) {
    if (catalog.has(id)) {
      throw new UsageError(`Model "${id}" is defined both in the model registry and in the suite`);
    }
    catalog.set(id, toResolved(id, definition));
  }
  return catalog;
}

export function selectModels(
  requested: readonly string[] | undefined,
  suite: SuiteDefinition,
  catalog: ReadonlyMap<string, ResolvedModel>,
): ResolvedModel[] {
  const ids =
    requested ??
    (suite.models ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.id));
  if (ids.length === 0) {
    throw new UsageError('No models to run', [
      'Pass --models a,b or list models in the suite file.',
      `Known models: ${[...catalog.keys()].join(', ')}`,
    ]);
  }

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new UsageError(`Model listed twice: ${[...new Set(duplicates)].join(', ')}`);
  }

  return ids.map((id) => {
    const model = catalog.get(id);
    if (model === undefined) {
      throw new UsageError(`Unknown model "${id}"`, [
        `Known models: ${[...catalog.keys()].join(', ')}`,
      ]);
    }
    return model;
  });
}

export function casesForModel(suite: SuiteDefinition, model: ResolvedModel): CaseDefinition[] {
  return suite.cases.filter(
    (testCase) =>
      testCase.kind === caseKindByModelKind[model.kind] &&
      (testCase.models === undefined || testCase.models.includes(model.id)),
  );
}

export function modelsWithCases(
  suite: SuiteDefinition,
  models: readonly ResolvedModel[],
): { model: ResolvedModel; cases: number }[] {
  return models.flatMap((model) => {
    const cases = casesForModel(suite, model).length;
    return cases === 0 ? [] : [{ model, cases }];
  });
}

export function assertSomeModelHasCases(
  suite: SuiteDefinition,
  models: readonly ResolvedModel[],
): void {
  if (modelsWithCases(suite, models).length > 0) return;
  throw new UsageError(
    `None of the selected models has a case in the suite "${suite.suite}"`,
    models.map((model) => `${model.id} (${model.kind})`),
  );
}

export function assertCaseModelsKnown(
  file: string,
  suite: SuiteDefinition,
  catalog: ReadonlyMap<string, ResolvedModel>,
): void {
  const problems = suite.cases.flatMap((testCase, index) =>
    (testCase.models ?? []).flatMap((id) => {
      const model = catalog.get(id);
      const at = `cases[${index}].models`;
      if (model === undefined) return [`${at}: "${id}" is not a known model`];
      if (caseKindByModelKind[model.kind] === testCase.kind) return [];
      return [
        `${at}: "${id}" (${model.kind}) cannot run the ${testCase.kind} case "${testCase.id}"`,
      ];
    }),
  );
  if (problems.length > 0)
    throw new UsageError(`${file} names models that cannot run its cases`, problems);
}
