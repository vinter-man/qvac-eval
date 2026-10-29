# 3. Every SDK version is installed beside the others and loaded by path

- Status: accepted
- Date: 2026-10-29

## Context

The point of the tool is to run the same cases on two versions of `@qvac/sdk` and compare. Installing the package takes about 2 GB and 200 dependencies, so it cannot be a dependency of the tool itself: the unit tests and lint would pay for it on every push, and one `node_modules` holds one version.

## Decision

- `@qvac/sdk` is an optional peer dependency (`>=0.21.0 <1.0.0`, the range that was run). The tool never imports its types.
- `--sdk-version x` installs that version with `npm install --prefix .qvac-eval/sdk/<version>` once, resolves tags such as `latest` through `npm view`, and imports the package by its file URL. Without the flag the SDK installed next to the project is used.
- The adapter describes the dozen functions it calls as plain interfaces (`src/adapter/sdk-api.ts`), so it compiles without the SDK and works with every version that has `completion().events`, `embed` and `transcribe`.
- The worker is started with `heartbeat()` before the first model loads, so the first load time is not inflated by about 650 ms of worker start-up.

## Consequences

- CI for the tool itself installs nothing heavy. The eval workflow caches npm's download cache per SDK version and the model weights per model.
- Two versions are two processes: `qvac-eval run` once per version, then `report` or `compare`.
- `1.0.0` and `1.1.0` on npm are deprecated releases of an older numbering. The tool follows the `latest` tag, which is `0.22.0`.
