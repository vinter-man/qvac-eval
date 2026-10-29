# 1. Cases do not know their model

- Status: accepted
- Date: 2026-10-29

## Context

A first sketch of a suite put one `model:` at the top of the file and mixed completion, embedding and transcription cases under it. No single model does all three, and a regression test is worth most when the same cases run against several models and several SDK versions.

## Decision

- A case describes an input and what a good answer looks like. It names no model.
- Models live in `models.yaml` with their kind (`llm`, `embedding`, `asr`), their registry constant or URL, their license and their size. A suite lists default models by id, and `--models` replaces the list.
- A model runs the cases of its own kind. A case can narrow itself with `models: [id]`. A model with no case in the suite is skipped, and `qvac-eval matrix` leaves it out of the CI matrix.

## Consequences

- One `smoke.yaml` covers three capabilities, and adding a fourth LLM to the matrix is one line in `models.yaml`.
- Expectations that depend on a model (`dims: 768`) pin the case to it with `models:`.
- Golden outputs are stored per model, because the same case gets a different, correct answer from each.
