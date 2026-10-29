import { formatMs, formatNumber, quote } from '../format.js';
import type { CheckResult, Diff } from '../report/schema.js';
import type { CompletionExpect, EmbedExpect, TranscribeExpect } from '../suites/schema.js';
import { parseJsonOutput, validateAgainstSchema } from './json-schema.js';
import { collapseWhitespace, wordErrorRate } from './text.js';
import { cosineSimilarity, euclideanNorm } from './vector.js';

export interface Evaluated {
  checks: CheckResult[];
  diff?: Diff;
}

export interface CompletionObservation {
  outputs: readonly string[];
  latencyMs: number;
  ttftMs?: number;
  tokensPerSecond?: number;
}

export interface EmbedObservation {
  vectors: readonly (readonly number[])[];
  latencyMs: number;
}

export interface TranscribeObservation {
  text: string;
  latencyMs: number;
  realTimeFactor?: number;
}

export const NORM_TOLERANCE = 0.01;

function check(name: string, passed: boolean, extra: Partial<CheckResult> = {}): CheckResult {
  return { name, passed, ...extra };
}

function foldCase(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLowerCase();
}

function containsAll(text: string, needles: readonly string[], caseSensitive: boolean) {
  const haystack = foldCase(text, caseSensitive);
  return needles.filter((needle) => !haystack.includes(foldCase(needle, caseSensitive)));
}

export function checkCompletion(
  expect: CompletionExpect,
  observation: CompletionObservation,
  requireDeterminism: boolean,
): Evaluated {
  const checks: CheckResult[] = [];
  let diff: Diff | undefined;
  const text = observation.outputs[0] ?? '';
  const caseSensitive = expect.caseSensitive ?? false;

  if (expect.exact !== undefined) {
    const passed =
      foldCase(collapseWhitespace(text), caseSensitive) ===
      foldCase(collapseWhitespace(expect.exact), caseSensitive);
    checks.push(check('exact', passed, { expected: quote(expect.exact), actual: quote(text) }));
    if (!passed) diff = { expected: expect.exact, actual: text };
  }

  if (expect.contains !== undefined) {
    const missing = containsAll(text, expect.contains, caseSensitive);
    checks.push(
      check('contains', missing.length === 0, {
        expected: expect.contains.map((needle) => quote(needle)).join(', '),
        actual: quote(text),
        ...(missing.length > 0 && {
          detail: `missing ${missing.map((needle) => quote(needle)).join(', ')}`,
        }),
      }),
    );
  }

  if (expect.notContains !== undefined) {
    const present = expect.notContains.filter(
      (needle) => containsAll(text, [needle], caseSensitive).length === 0,
    );
    checks.push(
      check('notContains', present.length === 0, {
        expected: `none of ${expect.notContains.map((needle) => quote(needle)).join(', ')}`,
        actual: quote(text),
        ...(present.length > 0 && {
          detail: `found ${present.map((needle) => quote(needle)).join(', ')}`,
        }),
      }),
    );
  }

  if (expect.regex !== undefined) {
    const passed = new RegExp(expect.regex, caseSensitive ? 'u' : 'iu').test(text);
    checks.push(check('regex', passed, { expected: `/${expect.regex}/`, actual: quote(text) }));
  }

  if (expect.jsonSchema !== undefined) {
    const parsed = parseJsonOutput(text);
    if (!parsed.ok) {
      checks.push(
        check('jsonSchema', false, {
          expected: 'JSON that matches the schema',
          actual: quote(text),
          detail: `not valid JSON: ${parsed.message}`,
        }),
      );
    } else {
      const verdict = validateAgainstSchema(parsed.value, expect.jsonSchema);
      checks.push(
        check('jsonSchema', verdict.ok, {
          expected: 'JSON that matches the schema',
          actual: quote(text),
          ...(!verdict.ok && { detail: verdict.message }),
        }),
      );
    }
  }

  if (requireDeterminism) {
    const differing = observation.outputs.filter((output) => output !== text).length;
    checks.push(
      check('deterministic', differing === 0, {
        expected: `${observation.outputs.length} identical outputs`,
        actual:
          differing === 0
            ? 'identical'
            : `${differing} of ${observation.outputs.length - 1} repeats differ from the first run`,
      }),
    );
  }

  if (expect.maxLatencyMs !== undefined) {
    checks.push(
      check('maxLatencyMs', observation.latencyMs <= expect.maxLatencyMs, {
        expected: `<= ${formatMs(expect.maxLatencyMs)}`,
        actual: formatMs(observation.latencyMs),
      }),
    );
  }

  if (expect.maxTtftMs !== undefined) {
    const actual = observation.ttftMs;
    checks.push(
      check('maxTtftMs', actual !== undefined && actual <= expect.maxTtftMs, {
        expected: `<= ${formatMs(expect.maxTtftMs)}`,
        actual: actual === undefined ? 'not reported' : formatMs(actual),
      }),
    );
  }

  if (expect.minTokensPerSecond !== undefined) {
    const actual = observation.tokensPerSecond;
    checks.push(
      check('minTokensPerSecond', actual !== undefined && actual >= expect.minTokensPerSecond, {
        expected: `>= ${expect.minTokensPerSecond} tok/s`,
        actual: actual === undefined ? 'not reported' : `${formatNumber(actual, 1)} tok/s`,
      }),
    );
  }

  return { checks, ...(diff && { diff }) };
}

export function pairSimilarity(
  vectors: readonly (readonly number[])[],
  pair: readonly [number, number],
): number {
  const [first, second] = pair;
  const left = vectors[first];
  const right = vectors[second];
  if (left === undefined || right === undefined) {
    throw new RangeError(`Pair [${first}, ${second}] is outside ${vectors.length} vectors`);
  }
  return cosineSimilarity(left, right);
}

export function checkEmbedding(expect: EmbedExpect, observation: EmbedObservation): Evaluated {
  const checks: CheckResult[] = [];
  const { vectors } = observation;

  if (expect.dims !== undefined) {
    const sizes = [...new Set(vectors.map((vector) => vector.length))];
    checks.push(
      check('dims', sizes.length === 1 && sizes[0] === expect.dims, {
        expected: String(expect.dims),
        actual: sizes.join(', '),
      }),
    );
  }

  if (expect.normalized === true) {
    const norms = vectors.map((vector) => euclideanNorm(vector));
    const worst = Math.max(...norms.map((norm) => Math.abs(norm - 1)));
    checks.push(
      check('normalized', worst <= NORM_TOLERANCE, {
        expected: `norm 1 ± ${NORM_TOLERANCE}`,
        actual: norms.map((norm) => formatNumber(norm, 4)).join(', '),
      }),
    );
  }

  if (expect.cosineMin !== undefined) {
    const similarity = pairSimilarity(vectors, [0, 1]);
    checks.push(
      check('cosineMin', similarity >= expect.cosineMin, {
        expected: `>= ${expect.cosineMin}`,
        actual: formatNumber(similarity, 4),
      }),
    );
  }

  if (expect.cosineMax !== undefined) {
    const similarity = pairSimilarity(vectors, [0, 1]);
    checks.push(
      check('cosineMax', similarity <= expect.cosineMax, {
        expected: `<= ${expect.cosineMax}`,
        actual: formatNumber(similarity, 4),
      }),
    );
  }

  for (const rule of expect.ranking ?? []) {
    const closer = pairSimilarity(vectors, rule.closer);
    const farther = pairSimilarity(vectors, rule.than);
    checks.push(
      check(`ranking [${rule.closer.join(',')}] > [${rule.than.join(',')}]`, closer > farther, {
        expected: `cos[${rule.closer.join(',')}] > cos[${rule.than.join(',')}]`,
        actual: `${formatNumber(closer, 4)} vs ${formatNumber(farther, 4)}`,
      }),
    );
  }

  if (expect.maxLatencyMs !== undefined) {
    checks.push(
      check('maxLatencyMs', observation.latencyMs <= expect.maxLatencyMs, {
        expected: `<= ${formatMs(expect.maxLatencyMs)}`,
        actual: formatMs(observation.latencyMs),
      }),
    );
  }

  return { checks };
}

export function checkTranscription(
  expect: TranscribeExpect,
  observation: TranscribeObservation,
): Evaluated {
  const checks: CheckResult[] = [];
  let diff: Diff | undefined;

  if (expect.reference !== undefined && expect.werMax !== undefined) {
    const wer = wordErrorRate(expect.reference, observation.text);
    const passed = wer <= expect.werMax;
    checks.push(
      check('werMax', passed, {
        expected: `WER <= ${expect.werMax}`,
        actual: `WER ${formatNumber(wer, 3)}`,
      }),
    );
    if (!passed) diff = { expected: expect.reference, actual: observation.text };
  }

  if (expect.contains !== undefined) {
    const missing = containsAll(observation.text, expect.contains, false);
    checks.push(
      check('contains', missing.length === 0, {
        expected: expect.contains.map((needle) => quote(needle)).join(', '),
        actual: quote(observation.text),
        ...(missing.length > 0 && {
          detail: `missing ${missing.map((needle) => quote(needle)).join(', ')}`,
        }),
      }),
    );
  }

  if (expect.maxLatencyMs !== undefined) {
    checks.push(
      check('maxLatencyMs', observation.latencyMs <= expect.maxLatencyMs, {
        expected: `<= ${formatMs(expect.maxLatencyMs)}`,
        actual: formatMs(observation.latencyMs),
      }),
    );
  }

  if (expect.maxRealTimeFactor !== undefined) {
    const actual = observation.realTimeFactor;
    checks.push(
      check('maxRealTimeFactor', actual !== undefined && actual <= expect.maxRealTimeFactor, {
        expected: `RTF <= ${expect.maxRealTimeFactor}`,
        actual: actual === undefined ? 'not reported' : `RTF ${formatNumber(actual, 3)}`,
      }),
    );
  }

  return { checks, ...(diff && { diff }) };
}
