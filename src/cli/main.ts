import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';

import { describeError, InfraError, UsageError } from '../errors.js';
import { InterruptedError } from '../run/execute.js';
import { TOOL_VERSION } from '../version.js';
import { compareCommand, reportCommand, type ReportOptions } from './commands/report.js';
import { runCommand, type RunOptions } from './commands/run.js';
import type { CliDeps } from './deps.js';

export const EXIT_INTERRUPTED = 130;

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a whole number, 1 or more');
  }
  return parsed;
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function withReportOptions(command: Command): Command {
  return command
    .option('--html <file>', 'write a self-contained HTML report')
    .option('--md <file>', 'write a Markdown report')
    .option('--summary <file>', 'append a Markdown summary to this file (for $GITHUB_STEP_SUMMARY)')
    .option('--merged-dir <dir>', 'write the merged JSON report of every SDK version here')
    .option('--history-link <href>', 'link the report back to a history page')
    .option('--config <file>', 'thresholds (default: ./qvac-eval.config.yaml if present)');
}

export function buildProgram(deps: CliDeps, setExit: (code: number) => void): Command {
  const program = new Command('qvac-eval')
    .description('Regression tests for local AI models running on the QVAC SDK')
    .version(TOOL_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => deps.stdout.write(text),
      writeErr: (text) => deps.stderr.write(text),
    });

  program
    .command('run')
    .description('Run a suite against one or more models')
    .argument('<suite>', 'path to a suite YAML file')
    .option(
      '--models <ids>',
      'comma-separated model ids (default: the models listed in the suite)',
      parseList,
    )
    .option(
      '--sdk-version <version>',
      'run against this @qvac/sdk version (installed on demand); default: the installed one',
    )
    .option('--repeat <n>', 'run every case n times', parsePositiveInt, 1)
    .option('--out <dir>', 'directory for the JSON report', 'reports')
    .option(
      '--baseline <path|latest>',
      'compare with an earlier report (file, directory, or the newest in --out)',
    )
    .option('--update-golden', 'record the outputs of passing cases as the new golden files', false)
    .addOption(
      new Option('--device <device>', 'where to run inference')
        .choices(['cpu', 'gpu', 'auto'])
        .default('cpu'),
    )
    .option('--golden-dir <dir>', 'directory with golden files (default from the config)')
    .option(
      '--config <file>',
      'thresholds and timeouts (default: ./qvac-eval.config.yaml if present)',
    )
    .option(
      '--models-file <file>',
      'model registry (default: ./models.yaml, then the built-in one)',
    )
    .option('--cache-dir <dir>', 'where the SDK keeps downloaded model weights')
    .option('--summary <file>', 'append a Markdown summary to this file (for $GITHUB_STEP_SUMMARY)')
    .option('--verbose', 'show the SDK logs', false)
    .action(async (suite: string, options: RunOptions) => {
      setExit(await runCommand(suite, options, deps));
    });

  withReportOptions(
    program
      .command('report')
      .description('Merge reports and render them as an HTML page and Markdown')
      .argument(
        '<reports...>',
        'report files or directories (artifacts of several jobs can be merged)',
      )
      .option('--baseline <path|latest>', 'compare with an earlier report'),
  ).action(async (inputs: string[], options: ReportOptions) => {
    setExit(await reportCommand(inputs, options, deps));
  });

  withReportOptions(
    program
      .command('compare')
      .description('Compare two runs, typically two SDK versions on the same cases')
      .argument('<older>', 'the baseline report (file or directory)')
      .argument('<newer>', 'the report under test (file or directory)'),
  ).action(async (older: string, newer: string, options: ReportOptions) => {
    setExit(await compareCommand(older, newer, options, deps));
  });

  return program;
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  let exitCode = 0;
  const program = buildProgram(deps, (code) => {
    exitCode = code;
  });
  const fail = (message: string, details: readonly string[] = []) => {
    deps.stderr.write(
      `${[`error: ${message}`, ...details.map((line) => `  ${line}`)].join('\n')}\n`,
    );
  };

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    if (error instanceof UsageError) {
      fail(error.message, error.details);
      return 2;
    }
    if (error instanceof InfraError) {
      fail(error.message);
      return 2;
    }
    if (error instanceof InterruptedError) {
      deps.stderr.write('Interrupted\n');
      return EXIT_INTERRUPTED;
    }
    fail(`unexpected failure: ${describeError(error)}`);
    if (error instanceof Error && error.stack !== undefined) deps.stderr.write(`${error.stack}\n`);
    return 2;
  }
}
