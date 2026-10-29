# 4. Golden outputs are recorded per model and SDK version, and compared with a tolerance

- Status: accepted
- Date: 2026-10-29

## Context

At temperature 0 with a fixed seed the same model gives the same text run after run on one machine: the determinism check asserts it. Across SDK versions and across CPUs a float rounding can change a late token. An exact match against a golden file would turn that into noise, and a golden file recorded on one version has to be usable on the next, or it cannot say what an upgrade changed.

## Decision

- Golden files are `golden/<model>/<sdk version>/<suite>.json`, written by `--update-golden` for the cases that ask for one with `expect.golden`, and only if their checks passed.
- A run uses the golden of its own version, else the nearest older one, else the nearest newer one, and the report says which (`Golden outputs from SDK …`).
- Text is compared by normalised Levenshtein similarity (default minimum 0.85), embeddings by the worst cosine to the recorded vectors (default 0.98) and a changed shape is always a regression. Falling outside the tolerance makes the case `regressed`, not `failed`: the answer may be fine, it is different.
- Embeddings are stored to six decimals, one vector per line.

## Consequences

- Upgrading the SDK and re-running shows what moved against the last recorded version, without re-recording.
- A golden file recorded on arm64 can drift on x64. The tolerances are there for that, and a failure is a reason to look, then to re-record.
