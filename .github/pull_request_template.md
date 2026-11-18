## Requirements

<!-- Spec IDs this PR implements or changes, and the backlog issue. Example: FR-01, FR-02, RN-01 to RN-03 · Backlog #4 · Closes #12 -->

- **FR:**
- **RN:**
- **Backlog item / issue:**

## What changed

<!-- Short summary for the reviewer: behaviour first, then notable code changes. -->

-

### Database

- [ ] No schema change
- [ ] New migration generated with `npm run db:generate` (applied migrations were **not** edited)

### Docs

- [ ] No doc changes needed
- [ ] Updated: <!-- spec / ADR / design-system.md / CLAUDE.md / backlog.md -->

## How it was tested

<!-- Map each acceptance criterion / business rule to its test. Add manual checks done in the browser. -->

| Rule / criterion | Test |
|---|---|
| RN-xx … | `packages/core/src/…test.ts` › "RN-xx: …" |
| FR-xx "Dado … Quando … Então …" | `apps/server/test/…test.ts` › "…" |

- [ ] `npm run check` passes (lint, format, typecheck, tests)
- [ ] `npm run build` passes
- [ ] Tried it in the browser (`npm run dev`), keyboard-only where it matters (NFR-05)

## Screenshots

<!-- UI changes: before/after screenshots of the affected screens (light theme; dark if relevant). Delete this section if there is no UI change. -->

## Checklist

- [ ] Money handled as integer cents end to end, formatted only with `formatCents()`
- [ ] Dates as civil dates (`YYYY-MM-DD`, America/Sao_Paulo); no `new Date("YYYY-MM-DD")`
- [ ] Business writes and their audit row (FR-18) happen in one transaction
- [ ] All user-facing text in pt-BR; code and comments in English
