# Contributing / conventions

## Workflow
- Never commit to `main`. One branch per issue: `feat/<n>-<slug>`, `fix/<n>-<slug>`.
- Conventional commits: `feat(extension): …`, `fix(server): …`, `docs: …`, `chore: …`.
- Bring in `main` with merge, not rebase.
- Before pushing: lint + typecheck/build for every package you touched.

## Tests
- Every PR has a Playwright spec: `e2e/issue-<n>-<slug>.spec.ts` or `e2e/pr-<n>-<slug>.spec.ts`, mapping 1:1 to the PR test plan.
- Server: `pytest` in `server/tests/`.

## Code
- Extension: TypeScript strict, no site-specific selectors.
- Server: Python 3.12, typed, `ruff` + `mypy`.
- Secrets only in `.env` (never committed). The extension never holds LLM keys.

## Commands (planned)
| Area | Lint | Typecheck/build | Test |
|---|---|---|---|
| extension | not set up yet | `npm run typecheck && npm run build` | `npm run test:e2e` (dot), `:changed`, `:failed`, `:full` (PR log); see `e2e/README.md` |
| server | `uv run ruff check` | `uv run mypy app` | `uv run pytest` |
