# CLAUDE.md

Financial management system for **Color**, a small stationery and copy shop in São Paulo. It is a **local web app**: a Node server on one Windows 11 PC, with the UI in the browser. It replaces the owner's hand-made Excel spreadsheets for sales, expenses, cash closing and reports, and exports `.xlsx` files and database backups to OneDrive.

- Requirements: [`docs/spec.md`](docs/spec.md) (pt-BR). Glossary of domain terms: **§3**.
- Architecture decisions: [`docs/adr/`](docs/adr/), starting with [`0001-tech-stack.md`](docs/adr/0001-tech-stack.md).
- UI rules: [`docs/design-system.md`](docs/design-system.md).

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
npm start              # run the built app on http://127.0.0.1:3210
npm run db:generate -w @color-bms/server -- --name <what_changed>   # new migration from schema.ts
```

Dev data lives in `apps/server/.data/` (git-ignored). Override it with `COLOR_BMS_DATA_DIR`.

## Repository structure

```
packages/core/   Pure TypeScript, no I/O: business rules (RN-xx), money, civil dates,
                 pt-BR formatters, Zod schemas shared by server and web.
apps/server/     Fastify API + SQLite (better-sqlite3 + Drizzle).
  src/db/          schema.ts, connection + pragmas, migration runner
  src/modules/     one folder per feature (health, later sales, expenses, …)
  src/http/        cross-cutting HTTP concerns (host guard)
  migrations/      generated SQL migrations (committed)
apps/web/        Vite + React 18 + Tailwind 3 + shadcn/ui (design system from the landing page).
  src/components/ui/      shadcn components (only the ones we use)
  src/components/layout/  app shell, sidebar
  src/config/navigation.ts  main areas + Alt+N shortcuts
  src/pages/              one page per area
docs/            spec, ADRs, design system
```

## Conventions

- **Language:** code, comments, commits and docs in **English**. Every user-facing string is **pt-BR**.
- **Money is always integer cents** (`number`, safe integer) — never floats, never `parseFloat`, never `toFixed` for calculations. Format only at the edge with `formatCents()` from `@color-bms/core`. Rounding is half-up, per sale (spec §5).
- **Dates:** business dates are civil dates `"YYYY-MM-DD"` in **America/Sao_Paulo** (RN-15). Get today with `todayCivilDate()`. Instants (`created_at`, audit time) are ISO-8601 **UTC** strings. **Never** use `new Date("YYYY-MM-DD")`: it parses as UTC and lands on the previous day in São Paulo. Display with `formatCivilDate()` / `formatInstant()`.
- **Business rules live in `packages/core`** as pure functions. Cite the spec ID in code comments and test names, e.g. `// RN-07` and `it("RN-04: refund fee is proportional", …)`.
- **Validation:** Zod schemas in `packages/core`, used by both the server and the web app.
- **Database writes:** a business change and its audit row (FR-18) go in **one transaction**.
- **UI:** follow `docs/design-system.md` (dense, keyboard-first, rainbow only as an accent).

## Workflow rules

1. **Plan before coding** for anything non-trivial; check it against the spec and the ADRs.
2. **Small PRs**: one feature or concern per PR.
3. **Write tests for every business rule** (NFR-11), named after its RN/FR ID.
4. Run **`npm run check`** (and `npm run build` if build config changed) before saying a task is done.
5. **Never edit a migration that has been applied/committed.** Change `schema.ts` and generate a new one.
6. New dependencies: free, mainstream, offline-capable (NFR-03, NFR-10). Keep the web majors (React 18, Tailwind 3, Vite 5, Zod 3) aligned with the landing page.
7. A significant technical decision gets a new ADR in `docs/adr/`.
