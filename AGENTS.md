# Agent guide

qvac-eval runs regression tests for local models through `@qvac/sdk`: YAML suites, golden outputs, performance numbers, and one HTML report that works offline. A GitHub Actions workflow runs it on a matrix and publishes the result to GitHub Pages.

## Rules

- Everything in the repository is English: code, copy, commit messages, pull requests and docs.
- No comments in code. Make the code say it through naming and structure; rationale belongs in the pull request or an ADR in `docs/adr`. ESLint rejects every comment except a shebang. The only comments in configuration are the version markers Renovate keeps next to pinned action SHAs in `.github`.
- No `any`, non-null assertions, `@ts-ignore`, dead code, unused exports or unused dependencies.
- Keep it boring: no speculative abstractions, no grab-bag `utils` modules; code lives next to the feature that uses it.
- `@qvac/sdk` is an optional peer dependency. The source never imports its types: the adapter describes what it calls in `src/adapter/sdk-api.ts`. Unit tests never download a model; they use the fakes in `test/support`.
- Model output is untrusted text. It reaches HTML only through the escaping `html` tag in `src/report/html/escape.ts`.
- The HTML report makes no network request and needs no JavaScript to show its content.
- Commit messages follow Conventional Commits. Pull request titles are checked with commitlint.

## Commands

| Command                                                     | What it does                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run build`                                             | Compile `src` into `dist`                                           |
| `npm run verify`                                            | Lint, type check, formatting, unused code, unit tests with coverage |
| `npm test`                                                  | Unit tests                                                          |
| `node dist/cli/index.js run <suite>`                        | Run a suite; needs the SDK, which `--sdk-version` installs          |
| `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint` | Lint the workflows                                                  |

## Layout

- `src/adapter` talks to the SDK, `src/suites` loads YAML, `src/metrics` has the pure maths and the checks, `src/run` is the engine, `src/report` builds JSON, Markdown, HTML and the history, `src/cli` has the commands.
- `cases`, `golden`, `fixtures`, `models.yaml`, `qvac-eval.config.yaml` are data. A golden file is recorded with `--update-golden`, never edited by hand.
- `docs/remotion` renders the pictures of the README from real runs. It has its own `package.json` and is not part of the build.

## Review gate

Every change goes through an independent reviewer that did not write it. It reads the diff, runs `npm run verify`, and answers `VERDICT: GREEN` or `VERDICT: RED` with findings that carry evidence. Fix a finding, or answer with proof that it is wrong; nits never block.
