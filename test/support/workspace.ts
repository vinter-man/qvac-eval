import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qvac-eval-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

export const MODELS_YAML = `
models:
  tiny-llm:
    kind: llm
    source: TINY_LLM
    license: Apache-2.0
    sizeMb: 100
  tiny-embed:
    kind: embedding
    source: TINY_EMBED
  tiny-asr:
    kind: asr
    source: TINY_ASR
`;

export const SUITE_YAML = `
suite: demo
models: [tiny-llm]
defaults:
  temperature: 0
  seed: 1
  maxTokens: 16
  timeoutMs: 400
cases:
  - id: capital
    kind: completion
    input: Capital of France? One word.
    expect:
      contains: [Paris]
  - id: json
    kind: completion
    input: Return {"ok":true}
    expect:
      jsonSchema:
        type: object
        required: [ok]
`;
