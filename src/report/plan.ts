import { z } from 'zod';

import { UsageError } from '../errors.js';
import { compareVersions } from '../run/golden.js';
import { modelKindSchema } from '../suites/schema.js';
import type { ModelRun, RunReport } from './schema.js';
import { summarize, verdictFor } from './summary.js';

const planEntrySchema = z.object({
  model: z.string(),
  kind: modelKindSchema,
  source: z.string(),
  sdks: z.array(z.string()).min(1),
  runner: z.string(),
});

const planSchema = z.object({ include: z.array(planEntrySchema) });
export type Plan = z.infer<typeof planSchema>;

export function parsePlan(text: string, file: string): Plan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`Plan ${file} is not valid JSON`, [String(error)]);
  }
  const result = planSchema.safeParse(parsed);
  if (!result.success) {
    throw new UsageError(
      `${file} is not a plan printed by "qvac-eval matrix"`,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

function withModels(report: RunReport, models: ModelRun[]): RunReport {
  const summary = summarize(models);
  return { ...report, models, summary, verdict: verdictFor(models, summary) };
}

function emptyGroup(template: RunReport, version: string): RunReport {
  return withModels(
    {
      schemaVersion: template.schemaVersion,
      tool: template.tool,
      suite: template.suite,
      startedAt: template.startedAt,
      finishedAt: template.finishedAt,
      options: template.options,
      environment: { ...template.environment, sdk: { ...template.environment.sdk, version } },
      models: [],
      summary: summarize([]),
      verdict: 'pass',
    },
    [],
  );
}

export function jobsOf(plan: Plan, runner: string): Plan['include'] {
  const entries = plan.include.filter((entry) => entry.runner === runner);
  if (entries.length === 0) {
    throw new UsageError(`The plan has no job for the runner "${runner}"`, [
      ...new Set(plan.include.map((entry) => entry.runner)),
    ]);
  }
  return entries;
}

export function expectPlan(groups: readonly RunReport[], plan: Plan, runner: string): RunReport[] {
  const [template] = groups;
  if (template === undefined) throw new UsageError('No reports to complete with the plan');
  const entries = jobsOf(plan, runner);
  const versions = [
    ...new Set([
      ...groups.map((group) => group.environment.sdk.version),
      ...entries.flatMap((entry) => entry.sdks),
    ]),
  ];

  return versions
    .map((version) => {
      const group =
        groups.find((candidate) => candidate.environment.sdk.version === version) ??
        emptyGroup(template, version);
      const missing: ModelRun[] = entries
        .filter(
          (entry) =>
            entry.sdks.includes(version) &&
            !group.models.some((run) => run.model.id === entry.model),
        )
        .map((entry) => ({
          model: { id: entry.model, kind: entry.kind, source: entry.source },
          status: 'infra-error',
          note: `no report arrived from the job of ${entry.model} on SDK ${version}: it failed before it could run`,
          regressions: [],
          cases: [],
        }));
      return missing.length === 0 ? group : withModels(group, [...group.models, ...missing]);
    })
    .sort((left, right) =>
      compareVersions(left.environment.sdk.version, right.environment.sdk.version),
    );
}
