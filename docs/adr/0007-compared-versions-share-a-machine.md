# 7. The SDK versions under comparison run one after the other on the same machine

- Status: accepted
- Date: 2026-10-29

## Context

A first version of the workflow made every SDK version its own matrix job. Two jobs of a hosted runner are two virtual machines, and they do not always get the same CPU. Comparing tokens per second across them measures the hardware lottery: in a first end-to-end run in a container, the same model on the same code showed a drop of 38% between two runs that only differed in whether the page cache was warm.

## Decision

- `qvac-eval matrix` plans one job per model and runner, and the job carries the list of SDK versions. The job runs them in sequence, on one machine, with one set of cached weights.
- The jobs of different models still run in parallel, and each uploads one report per version.

## Consequences

- A comparison is as fair as one machine allows. Run with `repeat` 3 or more to also take the median over the noise of a shared host.
- A job takes the sum of its versions: the install of the second SDK (about 30 s) and its run. The 20 minute limit is far above that for the small models in `models.yaml`.
- Load time still depends on the page cache, which is why its limit is +100% and it has a 500 ms floor ([5](0005-regressions-have-noise-floors.md)).
