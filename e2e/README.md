# e2e

Playwright tests that load the unpacked extension into Chromium (persistent context with `--load-extension`).

- One spec per issue/PR: `issue-<n>-<slug>.spec.ts` / `pr-<n>-<slug>.spec.ts`
- Header comment in each spec gives the run command.
- Fake sites served by `context.route` in `fixtures/extension.ts` (`anime-site.test`, `player.test`, `inner.test`) — no real streaming sites in tests. Subtitle fixtures: `fixtures/sample.srt`, `sample.ass`, `malformed.srt`, `notes.txt`.
- Helpers: `openPopup`, `loadFile`, `setTime`, `overlayIn` (see `fixtures/extension.ts`).

Run: `npx playwright test e2e/<spec>`

- Test cases and IDs: [docs/TEST_PLAN.md](../docs/TEST_PLAN.md). Put the ID in a comment above each `test()`.
- Log every PR / phase run in [docs/TEST_RESULTS.md](../docs/TEST_RESULTS.md) using its template.
