# Test results log

Newest run first. One entry per test run that matters: a PR's final run, a phase sign-off, or a regression you hit.
Paste output **verbatim**. If a check wasn't run, write `not run`. Never mark something passed without the output.

Test case IDs (`P0-01`, `P1-03`, …) refer to [TEST_PLAN.md](TEST_PLAN.md).

---

## Entry template

```markdown
## YYYY-MM-DD — <phase / PR / issue> — <PASS | FAIL | PARTIAL>

**Branch / commit:** `<branch>` @ `<short sha>`
**Environment:** macOS <ver>, Node <ver>, Playwright <ver>, TypeScript <ver>, Chromium (Playwright bundled)

### Checks
| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | ✓ / ✘ / not run |
| Typecheck | `npm run typecheck` | ✓ / ✘ / not run |
| Lint (extension) | not set up yet | not run |
| E2E | `npm run test:e2e -- e2e/<spec>` | N passed / N failed |
| Server lint | `uv run ruff check` | … |
| Server types | `uv run mypy app` | … |
| Server tests | `uv run pytest` | … |
| Manual (Chrome) | see TEST_PLAN.md § Manual checks | ✓ / ✘ / not run |

### Results by test case
| ID | Test | Result | Notes |
|---|---|---|---|

### Raw output
(verbatim ✓/✘ lines + summary)

### Issues
| # | Severity | Summary | Status |
|---|---|---|---|
```

Severity: **P0** blocker / data loss / security · **P1** core feature broken, workaround exists · **P2** minor.

---

## 2026-11-10 — Phase 0 scaffold (PR 1) — PASS

**Branch / commit:** `chore/phase-0-scaffold` @ no commits yet (all files untracked)
**Environment:** macOS 15.7.4, Node v24.18.0, Playwright 1.65.0, TypeScript 5.9.3, WXT 0.20.27, Chromium (Playwright bundled, new headless)

### Checks
| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | ✓ built `dist/chrome-mv3` (6.76 kB) |
| Typecheck | `npm run typecheck` | ✓ no errors (extension + e2e) |
| Lint (extension) | not set up yet | not run |
| E2E | `npx playwright test e2e/pr-1-phase-0-scaffold.spec.ts` | 5 passed |
| Server lint / types / tests | — | not run (no server code yet) |
| Safari build | `npm run build:safari -w extension` | not run |
| Manual (Chrome) | TEST_PLAN.md § Manual checks M0-01..M0-04 | not run |

### Results by test case
| ID | Test | Result | Notes |
|---|---|---|---|
| P0-01 | extension service worker starts | ✓ pass | 1.6s |
| P0-02 | overlay mounts over a video in the top frame | ✓ pass | 701ms |
| P0-03 | overlay mounts over a video inside a cross-origin iframe | ✓ pass | 693ms |
| P0-04 | no overlay on a page without video | ✓ pass | 628ms |
| P0-05 | popup renders with version | ✓ pass | 658ms |

### Raw output
```
Running 5 tests using 1 worker

  ✓  1 e2e/pr-1-phase-0-scaffold.spec.ts:10:1 › extension service worker starts (1.6s)
  ✓  2 e2e/pr-1-phase-0-scaffold.spec.ts:14:1 › overlay mounts over a video in the top frame (701ms)
  ✓  3 e2e/pr-1-phase-0-scaffold.spec.ts:20:1 › overlay mounts over a video inside a cross-origin iframe (693ms)
  ✓  4 e2e/pr-1-phase-0-scaffold.spec.ts:27:1 › no overlay on a page without video (628ms)
  ✓  5 e2e/pr-1-phase-0-scaffold.spec.ts:34:1 › popup renders with version (658ms)

  5 passed (4.7s)
```

### Issues
| # | Severity | Summary | Status |
|---|---|---|---|
| 1 | P2 | Branch `chore/phase-0-scaffold` has no commits; results aren't tied to a SHA yet. | open |
| 2 | P2 | `e2e/README.md` mentions a sample `.srt` fixture; none exists (`e2e/fixtures/` only has `extension.ts`). Needed for Phase 1 (P1-04+). | open |
| 3 | P2 | No extension lint configured (AGENTS.md: "not set up yet"). | open |
| 4 | P2 | Safari target never built or tested. | open |
| 5 | P2 | Manual Chrome check (M0-01..M0-04) not run on a real site. | open |
