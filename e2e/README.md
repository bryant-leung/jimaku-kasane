# e2e

Playwright tests that load the unpacked extension into Chromium (persistent context with `--load-extension`).

- One spec per issue/PR: `issue-<n>-<slug>.spec.ts` / `pr-<n>-<slug>.spec.ts`
- Header comment in each spec gives the run command.
- Fake sites served by `context.route` in `fixtures/extension.ts` (`anime-site.test`, `player.test`, `inner.test`) — no real streaming sites in tests. Subtitle fixtures: `fixtures/sample.srt`, `sample.ass`, `malformed.srt`, `notes.txt`.
- Helpers: `openPopup`, `loadFile`, `setTime`, `overlayIn` (see `fixtures/extension.ts`).

Run (all build the extension quietly first; output is `dot`: failures + totals only):

| Command | Use |
|---|---|
| `npm run test:e2e -- e2e/<spec>` | one spec while iterating |
| `npm run test:e2e:changed` | only specs touched by uncommitted changes (`--only-changed`) |
| `npm run test:e2e:failed` | re-run only last failures (`--last-failed`) |
| `npm run test:e2e` | full suite, parallel (about 5 min) |
| `npm run test:e2e:full` | full suite with one line per test, for PR output |

Conventions:
- Selectors: `getByRole` > `getByLabel` > `getByText` > `data-testid`. The overlay is `role="status"` named "Japanese subtitles".
- No `waitForTimeout`. Control video time with `setTime`; don't play real media.
- Each spec covers the happy path, an error path if it calls a network or API, repeat-safety for anything that writes (double click, re-load), and the empty state for lists.
- Pure logic (parsers, timing math) runs in Node under the same runner: import from `extension/src/lib/` and use the plain `@playwright/test` `test`.

Test cases and evidence:
- The test title is the case. List them all with `npx playwright test --list`. New tests need no case table and no ID.
- No run log in the repo. A PR's evidence is the verbatim output in its body (**Tests run**) and the CI run.
- Checks that need a real site: [docs/MANUAL_CHECKS.md](../docs/MANUAL_CHECKS.md).
- Older specs cite case IDs from the archived tables: [docs/archive/TEST_PLAN-2026-11.md](../docs/archive/TEST_PLAN-2026-11.md).
