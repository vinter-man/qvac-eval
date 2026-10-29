import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

export type SchemaVerdict = { ok: true } | { ok: false; message: string };

export type ParsedJson = { ok: true; value: unknown } | { ok: false; message: string };

export function compileJsonSchema(schema: JsonSchema): z.ZodType {
  return z.fromJSONSchema(schema);
}

export function assertCompilableSchema(schema: JsonSchema): SchemaVerdict {
  try {
    compileJsonSchema(schema);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
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
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
