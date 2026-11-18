# ADR 0002: End-to-end tests with Playwright

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-18 |
| **Deciders** | Project owner (developer) |
| **Related** | NFR-04, NFR-05, CS-2, CS-4 · FR-01, FR-08 · Backlog #4 (setup), #9 · ADR 0001 |

## Context

The pilot replaces the owner's daily spreadsheet, so the two flows he repeats all day must be fast and work with the keyboard alone:

- **Registering a sale** (FR-01): "valor → aba → forma → Enter", in **≤ 10 s per sale** (CS-2), saving in **< 1 s** (NFR-04), fully keyboard-operable (NFR-05).
- **Closing the day** (FR-08) in **≤ 3 min** (CS-4).

The current tests cannot prove this:

- Vitest unit and integration tests cover the rules and the API.
- jsdom component tests cannot check real focus movement, real key events, layout, or the built app talking to the real server and database.

The target browser is **Edge** on Windows 11 (NFR-02). Tests must stay free and offline-capable (NFR-03, NFR-10) and must not weaken the localhost-only server (NFR-08).

## Options considered

| | **A. Playwright (`@playwright/test`)** | **B. Cypress** | **C. Component tests only (Vitest + Testing Library)** |
|---|---|---|---|
| How it works | Drives real Chromium/Edge through the DevTools protocol; own test runner | Runs tests inside the browser | jsdom, no real browser |
| Keyboard realism | Real key events, real focus (`page.keyboard`) | Synthesized events by default; real keys need plugins | Simulated events, no layout or real focus |
| Edge | Yes (`channel: "msedge"`) | Yes | No |
| Full stack (built server + SQLite) | Yes | Yes | No |
| Speed / setup | Fast, parallel workers, one dev dependency | Heavier, slower | Fastest, already set up |
| Fit with the stack | TypeScript, mainstream; a Chromium + Playwright build is already pre-installed in the dev container | TypeScript, mainstream | Already in use |

Rejected early: **manual testing only**. CS-2 would then be checked once, not on every change.

## Decision

We choose **Option A: Playwright**. Component tests (Option C) stay for UI details.

### Layout and commands

- A new npm workspace `e2e/` (`@color-bms/e2e`) with `playwright.config.ts`, fixtures and `*.spec.ts` files. It is covered by `lint` and `typecheck` like the others; the Vitest projects do not include it.
- `npm run e2e` runs the suite against the **built** app. It needs `npm run build` first; the script runs the build.
- E2E tests are **not** part of `npm run check` because they are slower; CI runs them as a separate step. The `/feature` workflow runs them for every item with UI.

### What the tests run against

- The real production server: `node apps/server/dist/main.js`, which also serves the built web app.
- A **worker-scoped fixture** starts one server per Playwright worker with its own port (`3300 + workerIndex`) and a fresh temporary data folder (`COLOR_BMS_DATA_DIR`). Every worker starts from an empty, migrated database.
- **No test-only endpoints.** Fixtures create tabs, payment methods and fees through the same public API the UI uses.
- **Selectors:** by role and accessible name (`getByRole("button", { name: "Salvar" })`, `getByLabel("Valor")`), which doubles as an accessibility check. `data-testid` only as a last resort.

### Time

- The UI takes "today" from the server, never from the browser clock, so there is one source of truth (RN-15).
- The server reads the current time through a small `clock` module. **Only when `NODE_ENV=test`**, the variable `COLOR_BMS_NOW` (an ISO instant) sets the starting time, and the clock advances in real time from there.
- Tests for "today", closed days, future dates and midnight in São Paulo are therefore deterministic.
- This is the only test hook in production code. It is ignored in production and the server logs a warning if it is set there.

### Keyboard and CS-2

- **Keyboard-only flows:** after the page loads, sale and closing tests use only `page.keyboard`, never clicks. They check the focus order, that Enter submits, that focus returns to the value field after saving, and that the date is kept.
- **CS-2 is a human measurement** (stopwatch with the owner, spec §1.4). It is still done in backlog #27. The automated test guards the parts the system controls:
  1. **Keystroke budget:** a typical cash sale ("R$ 25,00 · Toner · Dinheiro") needs **≤ 12 keystrokes**. A typical card sale needs ≤ 15. The budget lives in the test and only changes on purpose, in review.
  2. **Save latency:** each save answers in **< 1 s** (NFR-04), measured from Enter to the confirmation.
  3. **Sustained pace:** **10 sales in a row**, typed at a slow beginner's pace (~250 ms per key), finish in **≤ 100 s** (average ≤ 10 s, CS-2).

### Browsers and CI

| Where | Browser | When |
|---|---|---|
| Linux (`ubuntu-latest`) | Chromium (`npx playwright install --with-deps chromium`) | Every PR and push to `main` |
| Windows (`windows-latest`) | **Edge** (`channel: "msedge"`, pre-installed on the runner) | Pushes to `main` |
| Developer machine | Chromium; Edge on Windows | `npm run e2e` |

- **No retries:** a flaky test is a bug to fix, not to retry.
- Traces are off by default and turned on to debug one test (`npm run e2e -- --trace on <file>`). The HTML report is uploaded as a CI artifact on failure.
- In this repo's cloud dev container, Chromium is pre-installed at `/opt/pw-browsers/chromium`. If the pinned `@playwright/test` version doesn't match it, the config uses that path through an environment variable instead of downloading a browser.

## Consequences

### Positive
- The two daily flows are tested end to end on every PR, keyboard-only, against the real built app and database.
- CS-2 and NFR-04 regressions (an extra required field, a slow query) fail CI instead of being noticed by the owner.
- Edge, the browser the owner uses, is tested on Windows.
- The same tooling can produce the PR screenshots required by the PR template.

### Negative / accepted trade-offs
- Another dev dependency and a browser download in CI, which adds roughly 1–2 minutes to the Linux job. *Mitigation:* Chromium only, cached npm.
- A test-only clock override in production code. *Mitigation:* active only with `NODE_ENV=test`, a single module, and a warning in the logs otherwise.
- E2E tests are slower and more brittle than unit tests. *Mitigation:* keep them to user flows, use role/label selectors, never retry.
- The keystroke budget constrains the sale form design: tab and payment method need type-ahead or digit shortcuts, not mouse-only dropdowns. This is intended (NFR-05).

### Follow-ups
- [x] Backlog #4: set up the `e2e` workspace, fixtures, the `clock` module, the CI steps and the first tests (sale flow + CS-2 budget).
- [ ] Backlog #9: add the keyboard-only day-closing test.
- [x] Update `CLAUDE.md` (commands) and the `/feature` skill once `npm run e2e` exists.
