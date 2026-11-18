---
name: feature
description: Implement one backlog item of the Color BMS end to end from the spec — read the FR and its RN rules, plan, write the business-rule tests first, implement (core → db → server → web), run all checks and update docs. Use when the user runs /feature with an FR ID (e.g. "/feature FR-01") or a backlog item number (e.g. "/feature #4").
argument-hint: FR-xx | #n
disable-model-invocation: true
---

# /feature $ARGUMENTS

Implement the backlog item identified by **`$ARGUMENTS`** (an FR ID such as `FR-01`, or a backlog number such as `#4`). Follow every step in order. Do not skip the plan approval or the tests-first step.

If `$ARGUMENTS` is empty, list the first backlog items in `docs/backlog.md` that are not done yet and ask which one to implement.

## 1. Gather the requirements (read-only)

1. Open `docs/backlog.md` and find the item that contains `$ARGUMENTS`. Note:
   - all FR IDs in that item (implement the **whole item**, not only the FR named);
   - its RN rules, acceptance criteria, scope, out-of-scope and "Depends on" list.
2. Check the dependencies. If an item listed under "Depends on" is not done yet (status `[ ]` in the backlog index, or its code is clearly missing), **stop** and tell the user which item must come first.
3. Read the full text in `docs/spec.md` of:
   - every FR in the item (§4);
   - every related RN (§5), including the "Valores monetários" paragraph whenever money is involved;
   - the entities touched in the data model (§6);
   - the glossary terms involved (§3).
4. Read the conventions in `CLAUDE.md`, the relevant ADRs in `docs/adr/`, and `docs/design-system.md` if the item has UI.
5. Look at existing code to reuse: `packages/core/src`, `apps/server/src/modules/*`, `apps/server/src/db/schema.ts`, `apps/web/src/pages`, `apps/web/src/components`.

If the spec is ambiguous or contradicts itself, check §10 (open questions) and §11 (assumptions) first. If it is still unclear, ask the user instead of guessing.

## 2. Propose a plan and wait for approval

Present a concise plan (use plan mode when available) with:

- **Scope:** the FRs, and what is explicitly out of scope.
- **Rules → tests:** a table mapping every RN and every acceptance criterion ("Dado / Quando / Então") to a named test and its file.
- **Core (`packages/core`):** the pure functions and Zod schemas to add.
- **Database:** tables and columns to add in `apps/server/src/db/schema.ts` (English names, money as `integer` cents, civil dates as `text` "YYYY-MM-DD", instants as `text` ISO UTC) and the migration name.
- **API (`apps/server/src/modules/<feature>/`):** endpoints (method, path, request/response schema, error cases in pt-BR) and which writes need an audit row (FR-18) in the same transaction.
- **UI (`apps/web`):** pages and components, keyboard flow (NFR-05), the pt-BR texts, and any shadcn components to add.
- **Docs** that will change.

**Stop and wait for the user to approve the plan** before writing code.

## 3. Write the tests first (red)

1. Write the failing tests before the implementation:
   - **Business rules** → unit tests in `packages/core/src/**/<name>.test.ts`. Name each test after its ID, e.g. `it("RN-03: net = gross − fee", …)`. Cover the spec's examples exactly (e.g. RN-03: R$ 150,00 at 3,79% → fee R$ 5,69, net R$ 144,31), plus edge cases: rounding at .005, negative values (refunds), zero, the largest allowed amount, and dates around midnight in São Paulo.
   - **Acceptance criteria** → integration tests in `apps/server/test/<feature>.test.ts` using `app.inject()` against a temp-dir database (follow `apps/server/test/health.test.ts`). One test per "Dado / Quando / Então", named after the FR, e.g. `it("FR-01: blocks a sale on a closed day", …)`. Assert the audit rows too.
   - **UI behaviour** that matters (keyboard flow, validation messages) → component tests in `apps/web/src/**/*.test.tsx`.
2. Run `npm test` and confirm the new tests **fail for the right reason** (missing code, not a typo).

## 4. Implement (green), inside-out

1. **Core:** pure functions and Zod schemas. No I/O, no `Date.now()` inside rules (pass `now`/`today` in). Integer cents only, with half-up rounding as spec §5 says.
2. **Database:** edit `schema.ts`, then run `npm run db:generate -w @color-bms/server -- --name <what_changed>`. **Never edit an existing migration.**
3. **Server:** a module in `src/modules/<feature>/`, registered in `src/app.ts`. Validate input with the core Zod schemas. Every business write and its audit row go in **one** better-sqlite3 transaction. Return errors with pt-BR messages the UI can show.
4. **Web:** pages and components following `docs/design-system.md` (dense, keyboard-first, Enter submits, focus returns to the first field). Format values only with `formatCents`, `formatCivilDate` and `formatInstant`. All text in pt-BR. Replace the placeholder page for the area.
5. Re-run `npm test` until everything is green. Then refactor for clarity; the owner is learning, so prefer simple, explicit code with short comments that cite the spec IDs.

## 5. Verify

1. Run `npm run check` (lint, format, typecheck, tests). Fix every failure; never skip or weaken a test to get green.
2. Run `npm run build`.
3. If there is UI: start the app (`npm run dev`), use the feature in the browser, keyboard-only for data entry, and take screenshots for the PR (Playwright, 1440×900).
4. Check the CLAUDE.md conventions on the diff: cents, civil dates, audit rows in transactions, pt-BR strings, English code.

## 6. Update docs

- `docs/backlog.md`: mark the item done (`[x]` in the index) and note any follow-ups it revealed.
- `docs/design-system.md`: new shadcn components or UI patterns.
- `docs/adr/`: a new ADR (from `0000-template.md`, added to the index) if you made a significant technical decision.
- `CLAUDE.md`: new commands or conventions.
- `docs/spec.md`: **do not edit.** If the spec needs a change, list it in the report for the owner to decide.

## 7. Report

Finish with:

- what was implemented, per FR;
- the rules → tests table, with all tests passing;
- the output summary of `npm run check` and `npm run build`;
- screenshots, if there is UI;
- open questions and follow-ups;
- a PR description ready to paste, following `.github/pull_request_template.md`.

Commit on a feature branch named like `feature/fr-01-register-sale`. Do not push or open a PR unless the user asks.
