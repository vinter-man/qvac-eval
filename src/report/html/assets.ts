import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FontAssets {
  onest: string;
  martianMono: string;
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(file);
  return `data:font/woff2;base64,${bytes.toString('base64')}`;
}

export async function loadFontAssets(packageRoot: string): Promise<FontAssets> {
  const directory = join(packageRoot, 'assets', 'fonts');
  const [onest, martianMono] = await Promise.all([
    dataUri(join(directory, 'onest-latin.woff2')),
    dataUri(join(directory, 'martian-mono-latin.woff2')),
  ]);
  return { onest, martianMono };
}
