# 2. Peak memory is the resident size of the process tree

- Status: accepted
- Date: 2026-10-29

## Context

`@qvac/sdk` runs inference in a separate `bare` worker process that the Node process spawns. After loading SmolLM2-360M the Node process holds about 120 MB and the worker 1.1 GB. `process.memoryUsage()` would report the 120 MB. The SDK offers its own resource sampling, but only on versions that have it, and a regression test across versions needs the same number from both.

## Decision

- While a model is loaded and its cases run, `qvac-eval` samples `ps -axo pid,ppid,rss` every 200 ms, sums the resident size of its own process and every descendant, and keeps the maximum.
- The sampler is injected, so the unit tests give it a fake process table. On Windows it reports nothing and the report leaves the field out.

## Consequences

- The figure includes the Node process (about 100 MB), so it is a little higher than the worker's own. It is the number that decides whether a model fits on a 16 GB runner.
- A run shorter than one interval is still measured: the sampler samples once when it starts and once when it stops.
