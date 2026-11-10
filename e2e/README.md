# e2e

Playwright tests that load the unpacked extension into Chromium (persistent context with `--load-extension`).

- One spec per issue/PR: `issue-<n>-<slug>.spec.ts` / `pr-<n>-<slug>.spec.ts`
- Header comment in each spec gives the run command.
- Fixture page: a local HTML page with a `<video>` (and one inside an iframe) plus sample `.srt` — no real streaming sites in tests.

Run: `npx playwright test e2e/<spec>`

- Test cases and IDs: [docs/TEST_PLAN.md](../docs/TEST_PLAN.md). Put the ID in a comment above each `test()`.
- Log every PR / phase run in [docs/TEST_RESULTS.md](../docs/TEST_RESULTS.md) using its template.
