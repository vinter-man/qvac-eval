import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SdkConfigOptions {
  file: string;
  modelCacheDir?: string;
  verbose: boolean;
}

export async function writeSdkConfig(options: SdkConfigOptions): Promise<string> {
  const config = {
    loggerLevel: options.verbose ? 'info' : 'error',
    loggerConsoleOutput: options.verbose,
    ...(options.modelCacheDir !== undefined && { cacheDirectory: options.modelCacheDir }),
  };
  await mkdir(dirname(options.file), { recursive: true });
  await writeFile(options.file, `${JSON.stringify(config, null, 2)}\n`);
  return options.file;
}
