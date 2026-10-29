import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';

import { describeError, InfraError, UsageError } from '../errors.js';
import { InterruptedError } from '../run/execute.js';
import { TOOL_VERSION } from '../version.js';
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
    .option('--verbose', 'show the SDK logs', false)
    .action(async (suite: string, options: RunOptions) => {
      setExit(await runCommand(suite, options, deps));
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
