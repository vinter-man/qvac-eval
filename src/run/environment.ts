import { availableParallelism, cpus, totalmem } from 'node:os';

import type { RunReport } from '../report/schema.js';

export type Environment = Omit<RunReport['environment'], 'sdk'>;

export function collectEnvironment(env: NodeJS.ProcessEnv): Environment {
  const model = cpus()[0]?.model.trim();
  const onGitHub = env.GITHUB_ACTIONS === 'true';
  const runner = [env.ImageOS, env.RUNNER_OS, env.RUNNER_ARCH]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  const runId = env.GITHUB_RUN_ID;
  const repository = env.GITHUB_REPOSITORY;
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const ref = env.GITHUB_REF_NAME;
  const sha = env.GITHUB_SHA;

  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ...(model !== undefined && model !== '' && { cpu: model }),
    cpuCount: availableParallelism(),
    memoryMb: Math.round(totalmem() / (1024 * 1024)),
    ...(onGitHub && {
      ci: {
        provider: 'github-actions' as const,
        ...(runner !== '' && { runner }),
        ...(runId !== undefined &&
          repository !== undefined && { runUrl: `${server}/${repository}/actions/runs/${runId}` }),
        ...(ref !== undefined && { ref }),
        ...(sha !== undefined && { sha: sha.slice(0, 7) }),
      },
    }),
  };
}
