#!/usr/bin/env node
import { createDefaultDeps } from './deps.js';
import { main } from './main.js';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    controller.abort();
  });
}

const code = await main(process.argv.slice(2), createDefaultDeps(controller.signal));
process.exitCode = code;
setTimeout(() => {
  process.exit(code);
}, 5000).unref();
