# 5. Regressions are measured against thresholds with absolute floors

- Status: accepted
- Date: 2026-10-29

## Context

A shared CI runner is noisy. A time to first token that goes from 10 ms to 16 ms is +60% and means nothing. Loading a model the second time takes a tenth of the first, because the weights are in the page cache. A tokens-per-second figure from a four-token answer swings by a factor of ten.

## Decision

- The limits live in `qvac-eval.config.yaml`: tokens per second −15%, time to first token +50%, p95 latency +50%, load time +100%, peak memory +25%, WER +0.05, cosine −0.02, golden similarity −0.1.
- A relative change only counts if it is also larger than a floor: 1 tok/s, 20 ms of time to first token, 100 ms of latency, 500 ms of load time, 64 MB of memory.
- Tokens per second is aggregated per model from the runs that generated at least 16 tokens: total tokens over total generation time. The suites carry a `throughput` case that forces 64 tokens.
- `embed` statistics are not used for speed: the SDK reports `tokensPerSecond: 26000000` when `totalTime` rounds to 0.001. Latency is measured around the call.
- Load time excludes the download when the SDK reports progress.

## Consequences

- A reported regression is a number worth a look. The price is that a real but small slowdown on a fast operation is not reported.
- `--repeat 3` takes the median per case and gives p50 and p95 something to work on.
