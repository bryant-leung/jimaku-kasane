# Contributing / conventions

## Workflow
- Never commit to `main`. One branch per issue: `feat/<n>-<slug>`, `fix/<n>-<slug>`, `chore/<n>-<slug>`.
- Cut every branch from `origin/main`. If the previous PR is still open, merge it first; don't build a branch on an unmerged one.
- PRs merge with a merge commit. Squash and rebase merging are turned off in the repo settings.
- Conventional commits: `feat(extension): …`, `fix(server): …`, `docs: …`, `chore: …`.
- Bring in `main` with merge, not rebase.
- Before pushing: run the Verify commands below for every package you touched.

## Tests
- Every PR has a Playwright spec: `e2e/issue-<n>-<slug>.spec.ts` or `e2e/pr-<n>-<slug>.spec.ts`, mapping 1:1 to the PR test plan. A docs-only or config-only PR lists the smoke spec instead.
- The specs are the test cases: `npx playwright test --list`. Checks that need a real site are in `docs/MANUAL_CHECKS.md`.
- Evidence goes in the PR body (commands and verbatim output) and the CI run. There is no run log in the repo.
- Server: `pytest` in `server/tests/`.

## Code
- Extension: TypeScript strict, no site-specific selectors.
- Server: Python 3.12, typed, `ruff` + `mypy`.
- Secrets only in `.env` (never committed). The extension never holds LLM keys.

## Verify
| Area | Lint | Typecheck/build | Test |
|---|---|---|---|
| extension, e2e, scripts | `npm run lint` | `npm run typecheck && npm run build` | `npm run test:e2e:changed` while iterating; `npm run test:e2e` before a PR (about 5 min); see `e2e/README.md` |
| server (`cd server`) | `uv run ruff check .` | `uv run mypy app` | `uv run pytest` |

CI (`.github/workflows/ci.yml`) runs on every PR and on `main`: lint, typecheck, build and the two smoke specs (`pr-1`, `pr-2`) for the extension; ruff, mypy and pytest for the server. The full e2e suite runs locally only.
