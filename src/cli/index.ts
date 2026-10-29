#!/usr/bin/env node
import { createDefaultDeps } from './deps.js';
import { main } from './main.js';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    controller.abort();
  });
}

process.exit(await main(process.argv.slice(2), createDefaultDeps(controller.signal)));
