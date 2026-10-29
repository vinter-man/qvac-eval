# 6. Inference runs on the CPU unless asked otherwise

- Status: accepted
- Date: 2026-10-29

## Context

A GitHub-hosted `ubuntu-24.04` runner has four vCPUs and no GPU, and a macOS runner has no Metal device inside its virtual machine. A laptop has a GPU, and numbers from it are not comparable with the runner's.

## Decision

- `--device cpu` is the default. It sets `device: cpu` for language and embedding models and `contextParams.use_gpu: false` for Whisper. `gpu` forces the GPU, `auto` leaves the choice to the SDK.
- The device the SDK says it used (`backendDevice`) goes into the report.

## Consequences

- A local run and a CI run measure the same thing, only on different silicon. On an M4 Pro SmolLM2-360M generates about 300 tokens per second; in a four-CPU Ubuntu container about 10 to 20.
- The model list is limited to what runs well on four cores: 0.3 to 1 billion parameters at 4 to 8 bits.
