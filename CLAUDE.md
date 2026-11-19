# CLAUDE.md

Financial management system for **Color**, a small stationery and copy shop in São Paulo. It is a **local web app**: a Node server on one Windows 11 PC, with the UI in the browser. It replaces the owner's hand-made Excel spreadsheets for sales, expenses, cash closing and reports, and exports `.xlsx` files and database backups to OneDrive.

- Requirements: [`docs/spec.md`](docs/spec.md) (pt-BR). Glossary of domain terms: **§3**.
- Work items: [`docs/backlog.md`](docs/backlog.md), the ordered MVP backlog with acceptance criteria.
- Architecture decisions: [`docs/adr/`](docs/adr/) (index and how-to in its README), starting with [`0001-tech-stack.md`](docs/adr/0001-tech-stack.md).
- UI rules: [`docs/design-system.md`](docs/design-system.md).

## Claude Code workflow

- **`/feature #n`** or **`/feature FR-xx`** (`.claude/skills/feature/`) implements one backlog item: requirements → plan (wait for approval) → tests first → implement → `npm run check` → docs.
- A **PostToolUse hook** (`.claude/hooks/format-lint.mjs`) runs Prettier and `eslint --fix` on every file Claude edits. If lint errors remain, fix them before moving on.
- PRs follow `.github/pull_request_template.md` (FR/RN IDs, what changed, tests, screenshots).
- New technical decision → new ADR from `docs/adr/0000-template.md`.

## Commands

Node **26** (see `.nvmrc`). Run everything from the repo root.

```bash
npm install            # install all workspaces
npm run dev            # API on http://127.0.0.1:3210 + UI on http://127.0.0.1:5173 (open this one)
npm test               # all unit/integration tests (Vitest)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit in every workspace
npm run format         # Prettier (write); format:check to verify
npm run check          # lint + format:check + typecheck + test (run before saying "done")
npm run build          # build web (Vite) and server (tsup)
npm run e2e            # build, then Playwright E2E tests in e2e/ (ADR 0002; not part of check)
npm start              # run the built app on http://127.0.0.1:3210
npm run package:pilot  # build, then dist-pilot/color-bms-<version>.zip for the shop PC (#26)
npm run pilot:smoke    # the pilot package end to end (install, crash → restart, update, go-live)
npm run db:generate -w @color-bms/server -- --name <what_changed>   # new migration from schema.ts
```

Dev data lives in `apps/server/.data/` (git-ignored). Override it with `COLOR_BMS_DATA_DIR`.

Backups (#25, [ADR 0003](docs/adr/0003-pilot-backup.md)) go to `<OneDrive folder>/_backup-sistema/`. The folder comes from `COLOR_BMS_ONEDRIVE_DIR`, or else from `{ "oneDriveFolder": "C:\\Users\\dono\\OneDrive\\Color" }` in `<data dir>/config.json` (JSON: double every backslash, or use `/`). Unset means no backup, and Início says so. Before pending migrations, a local backup goes to `<data dir>/backups/`. Manual restore: [`docs/pilot/restaurar-backup.md`](docs/pilot/restaurar-backup.md).

Pilot install (#26, [ADR 0004](docs/adr/0004-pilot-install.md), [`docs/pilot/install.md`](docs/pilot/install.md)): the zip's `.cmd` scripts only call `app\node\node.exe app\server\dist\pilot\cli.js <command>`. Put all logic and pt-BR messages in `apps/server/src/pilot/`, and keep the `.cmd` files ASCII. A Task Scheduler task starts `launcher.js` at logon, hidden; it restarts the server and writes `<data dir>/logs/`. Trial mode (`data-treino\`, `COLOR_BMS_TRIAL=1`) never backs up to OneDrive. Bump `apps/server/package.json` `version` for each pilot update.

## Repository structure

```
packages/core/   Pure TypeScript, no I/O: business rules (RN-xx), money, civil dates,
                 pt-BR formatters, Zod schemas shared by server and web.
apps/server/     Fastify API + SQLite (better-sqlite3 + Drizzle).
  src/db/          schema.ts, connection + pragmas, migration runner
  src/modules/     one folder per feature (health, audit, later sales, expenses, …)
  src/http/        cross-cutting HTTP concerns (host guard)
  migrations/      generated SQL migrations (committed)
apps/web/        Vite + React 18 + Tailwind 3 + shadcn/ui (design system from the landing page).
  src/components/ui/      shadcn components (only the ones we use)
  src/components/layout/  app shell, sidebar
  src/config/navigation.ts  main areas + Alt+N shortcuts
  src/pages/              one page per area
e2e/             Playwright E2E tests against the built app (one server + temp DB per worker)
docs/            spec, ADRs, design system
```

## Conventions

- **Language:** code, comments, commits and docs in **English**. Every user-facing string is **pt-BR**.
- **Money is always integer cents** (`number`, safe integer) — never floats, never `parseFloat`, never `toFixed` for calculations. Format only at the edge with `formatCents()` from `@color-bms/core`. Rounding is half-up, per sale (spec §5).
- **Dates:** business dates are civil dates `"YYYY-MM-DD"` in **America/Sao_Paulo** (RN-15). Get today with `todayCivilDate()`. Instants (`created_at`, audit time) are ISO-8601 **UTC** strings. **Never** use `new Date("YYYY-MM-DD")`: it parses as UTC and lands on the previous day in São Paulo. Display with `formatCivilDate()` / `formatInstant()`. Move between dates with `addDays()`; filter instants by business day with `civilDayStartInstant()` (start of the day in São Paulo, as UTC).
- **Business rules live in `packages/core`** as pure functions. Cite the spec ID in code comments and test names, e.g. `// RN-07` and `it("RN-04: refund fee is proportional", …)`.
- **Validation:** Zod schemas in `packages/core`, used by both the server and the web app.
- **Database writes:** a business change and its audit row (FR-18) go in **one transaction**: call `recordAudit(tx, { entity, entityId, action, before, after, reason })` from `apps/server/src/modules/audit/audit.repository.ts` inside `db.transaction((tx) => …)`. In `before`/`after`, money keys end in `Cents` (`grossCents: 5000`) so the Auditoria screen shows them as R$.
- **After a day is closed:** `buildApp({ onDayClosed })` runs after the closing commits (FR-08), right after the pilot backup (`buildApp({ backup })`, #25). Hook the spreadsheet exports (#21) there; a failure must never undo the closing.
- **Time on the server:** never call `new Date()` in business code; use the `Clock` passed to the routes (`apps/server/src/clock.ts`). `COLOR_BMS_NOW` sets it only with `NODE_ENV=test` (ADR 0002). The UI gets today from `GET /api/today`.
- **UI:** follow `docs/design-system.md` (dense, keyboard-first, rainbow only as an accent).

## Workflow rules

1. **Plan before coding** for anything non-trivial; check it against the spec and the ADRs.
2. **Small PRs**: one feature or concern per PR.
3. **Write tests for every business rule** (NFR-11), named after its RN/FR ID.
4. Run **`npm run check`** (and `npm run build` if build config changed) before saying a task is done.
5. **Never edit a migration that has been applied/committed.** Change `schema.ts` and generate a new one.
6. New dependencies: free, mainstream, offline-capable (NFR-03, NFR-10). Keep the web majors (React 18, Tailwind 3, Vite 5, Zod 3) aligned with the landing page.
7. A significant technical decision gets a new ADR in `docs/adr/`.
