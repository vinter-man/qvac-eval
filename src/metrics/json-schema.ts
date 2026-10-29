import { z } from 'zod';

import { describeError } from '../errors.js';

export type JsonSchema = Record<string, unknown>;

export type SchemaVerdict = { ok: true } | { ok: false; message: string };

export type ParsedJson = { ok: true; value: unknown } | { ok: false; message: string };

const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function declareRequired(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(declareRequired);
  if (!isRecord(node)) return node;

  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    copy[key] = DATA_KEYWORDS.has(key) ? value : declareRequired(value);
  }
  const { required } = copy;
  if (Array.isArray(required) && required.every((entry) => typeof entry === 'string')) {
    const declared = isRecord(copy.properties) ? copy.properties : {};
    copy.properties = {
      ...Object.fromEntries(required.map((entry: string) => [entry, {}])),
      ...declared,
    };
  }
  return copy;
}

function compileJsonSchema(schema: JsonSchema): z.ZodType {
  return z.fromJSONSchema(declareRequired(schema) as JsonSchema);
}

export function assertCompilableSchema(schema: JsonSchema): SchemaVerdict {
  try {
    compileJsonSchema(schema);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

export function validateAgainstSchema(value: unknown, schema: JsonSchema): SchemaVerdict {
  const result = compileJsonSchema(schema).safeParse(value);
  if (result.success) return { ok: true };
  const message = result.error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
  return { ok: false, message };
}

export function parseJsonOutput(text: string): ParsedJson {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text.trim());
  const candidate = fenced?.[1] ?? text.trim();
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}
