# Manual checks

Checks that need a real browser on a real site, so no Playwright spec covers them. Run the ones a change could affect and write the result (pass, fail or `not run`) in the PR body under **Tests run**.

Automated cases are the Playwright specs themselves: `npx playwright test --list`. The case tables and the run log kept until November 2026 are in [archive/](archive/).

## Phase 0: scaffold
| ID | Steps | Expected |
|---|---|---|
| M0-01 | `npm run build`, then load `extension/dist/chrome-mv3` unpacked in `chrome://extensions` | Loads with no errors on the card |
| M0-02 | Open any site with an HTML5 video | "JP Sub ready" overlay sits over the video |
| M0-03 | Open a text-only page | No overlay; nothing in the console from the extension |
| M0-04 | Click the toolbar icon | Popup shows name + version (from `extension/package.json`) |

## Phase 1: overlay
| ID | Steps | Expected |
|---|---|---|
| M1-01 | Real episode with Jimaku subs, play for 5 min | Lines stay in sync within ±0.3s after setting the offset |
| M1-02 | Toggle fullscreen several times while playing | Overlay never disappears or duplicates |
| M1-03 | Player in a cross-origin iframe on a real site | Overlay works inside the iframe |

## Phase 3a: audio auto-sync
| ID | Steps | Expected |
|---|---|---|
| M3-01 | real episode with TV-rip subs: click Auto-sync, keep playing ≤60 s | `Synced: offset +x.xs`; lines match the English hardsubs |
