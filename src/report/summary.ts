import type { ModelRun, Summary, Verdict } from './schema.js';

export function summarize(models: readonly ModelRun[]): Summary {
  const summary: Summary = {
    total: 0,
    passed: 0,
    failed: 0,
    regressed: 0,
    errored: 0,
    modelRegressions: 0,
  };
  for (const model of models) {
    summary.modelRegressions += model.regressions.length;
    for (const testCase of model.cases) {
      summary.total += 1;
      summary[testCase.status] += 1;
    }
  }
  return summary;
}

export function verdictFor(models: readonly ModelRun[], summary: Summary): Verdict {
  if (models.some((model) => model.status === 'infra-error')) return 'error';
  const problems = summary.failed + summary.regressed + summary.errored + summary.modelRegressions;
  return problems > 0 ? 'fail' : 'pass';
}

export function exitCodeFor(verdict: Verdict): 0 | 1 | 2 {
  if (verdict === 'pass') return 0;
  return verdict === 'fail' ? 1 : 2;
}
