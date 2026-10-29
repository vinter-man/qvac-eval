import { z } from 'zod';

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u, 'use letters, digits and . _ + - only');

const jsonSchemaObject = z.record(z.string(), z.unknown());

const unitInterval = z.number().min(0).max(1);

export const modelKindSchema = z.enum(['llm', 'embedding', 'asr']);
export type ModelKind = z.infer<typeof modelKindSchema>;

const generationSchema = z.strictObject({
  temperature: z.number().min(0).optional(),
  seed: z.int().optional(),
  maxTokens: z.int().positive().optional(),
  topP: unitInterval.optional(),
  topK: z.int().positive().optional(),
  reasoningBudget: z.int().min(0).optional(),
});
export type Generation = z.infer<typeof generationSchema>;

const modelFields = {
  kind: modelKindSchema,
  source: z.string().min(1),
  license: z.string().min(1).optional(),
  sizeMb: z.number().positive().optional(),
  homepage: z.url().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  generation: generationSchema.optional(),
};

const modelDefinitionSchema = z.strictObject(modelFields);
export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

const inlineModelSchema = z.strictObject({ id: identifier, ...modelFields });
export type InlineModel = z.infer<typeof inlineModelSchema>;

export const modelRegistrySchema = z.strictObject({
  models: z.record(identifier, modelDefinitionSchema),
});
export type ModelRegistry = z.infer<typeof modelRegistrySchema>;

const goldenTolerance = z.union([
  z.literal(true),
  z.strictObject({ minSimilarity: unitInterval.optional(), minCosine: unitInterval.optional() }),
]);
export type GoldenTolerance = z.infer<typeof goldenTolerance>;

const message = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type Message = z.infer<typeof message>;

const responseFormat = z.union([
  z.literal('json_object'),
  z.strictObject({ jsonSchema: jsonSchemaObject }),
]);
export type ResponseFormat = z.infer<typeof responseFormat>;

const completionExpect = z.strictObject({
  exact: z.string().optional(),
  contains: z.array(z.string().min(1)).optional(),
  notContains: z.array(z.string().min(1)).optional(),
  regex: z.string().min(1).optional(),
  jsonSchema: jsonSchemaObject.optional(),
  caseSensitive: z.boolean().optional(),
  golden: goldenTolerance.optional(),
  deterministic: z.boolean().optional(),
  maxLatencyMs: z.number().positive().optional(),
  maxTtftMs: z.number().positive().optional(),
  minTokensPerSecond: z.number().positive().optional(),
});
export type CompletionExpect = z.infer<typeof completionExpect>;

const rankingRule = z.strictObject({
  closer: z.tuple([z.int().min(0), z.int().min(0)]),
  than: z.tuple([z.int().min(0), z.int().min(0)]),
});

const embedExpect = z.strictObject({
  dims: z.int().positive().optional(),
  normalized: z.boolean().optional(),
  cosineMin: z.number().min(-1).max(1).optional(),
  cosineMax: z.number().min(-1).max(1).optional(),
  ranking: z.array(rankingRule).optional(),
  golden: goldenTolerance.optional(),
  maxLatencyMs: z.number().positive().optional(),
});
export type EmbedExpect = z.infer<typeof embedExpect>;

const transcribeExpect = z.strictObject({
  reference: z.string().min(1).optional(),
  werMax: z.number().min(0).optional(),
  contains: z.array(z.string().min(1)).optional(),
  golden: goldenTolerance.optional(),
  maxLatencyMs: z.number().positive().optional(),
  maxRealTimeFactor: z.number().positive().optional(),
});
export type TranscribeExpect = z.infer<typeof transcribeExpect>;

const caseFields = {
  id: identifier,
  description: z.string().optional(),
  timeoutMs: z.int().positive().optional(),
  models: z.array(identifier).min(1).optional(),
};

const completionCase = z.strictObject({
  ...caseFields,
  kind: z.literal('completion'),
  input: z.union([z.string().min(1), z.array(message).min(1)]),
  generation: generationSchema.optional(),
  responseFormat: responseFormat.optional(),
  expect: completionExpect.prefault({}),
});

const embedCase = z.strictObject({
  ...caseFields,
  kind: z.literal('embed'),
  input: z.array(z.string().min(1)).min(1),
  expect: embedExpect.prefault({}),
});

const transcribeCase = z.strictObject({
  ...caseFields,
  kind: z.literal('transcribe'),
  input: z.string().min(1),
  expect: transcribeExpect.prefault({}),
});

const caseSchema = z.discriminatedUnion('kind', [completionCase, embedCase, transcribeCase]);
export type CaseDefinition = z.infer<typeof caseSchema>;
export type CompletionCase = z.infer<typeof completionCase>;
export type EmbedCase = z.infer<typeof embedCase>;
export type TranscribeCase = z.infer<typeof transcribeCase>;

export const suiteSchema = z.strictObject({
  suite: identifier,
  description: z.string().optional(),
  models: z
    .array(z.union([identifier, inlineModelSchema]))
    .min(1)
    .optional(),
  defaults: generationSchema.extend({ timeoutMs: z.int().positive().optional() }).optional(),
  cases: z.array(caseSchema).min(1),
});
export type SuiteDefinition = z.infer<typeof suiteSchema>;

export const thresholdsSchema = z.strictObject({
  tokensPerSecondDropPct: z.number().positive().default(15),
  ttftIncreasePct: z.number().positive().default(50),
  latencyP95IncreasePct: z.number().positive().default(50),
  loadTimeIncreasePct: z.number().positive().default(100),
  peakRssIncreasePct: z.number().positive().default(25),
  werIncrease: z.number().positive().default(0.05),
  cosineDrop: z.number().positive().default(0.02),
  goldenSimilarityDrop: z.number().positive().default(0.1),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

export const configSchema = z.strictObject({
  thresholds: thresholdsSchema.prefault({}),
  golden: z
    .strictObject({
      dir: z.string().min(1).default('golden'),
      minSimilarity: unitInterval.default(0.85),
      minCosine: unitInterval.default(0.98),
    })
    .prefault({}),
  timeouts: z
    .strictObject({
      loadMs: z.int().positive().default(600_000),
      caseMs: z.int().positive().default(60_000),
    })
    .prefault({}),
});
export type EvalConfig = z.infer<typeof configSchema>;
