# ADR 0001: Technical stack

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-18 |
| **Deciders** | Project owner (developer) |
| **Related** | [`docs/spec.md`](../spec.md) §6 (data model), §7 (OneDrive), §8 (NFRs), §9 (scope) |

## Context

We are building the Color financial management system described in `docs/spec.md`. The spec and the developer impose these constraints:

- **Local web app** (NFR-01, NFR-02, NFR-08): a server process on a single Windows 11 PC. The UI runs in Edge or Chrome, and the server accepts connections from localhost only.
- **Embedded single-file database** (NFR-01), with transactions and no data loss after a confirmed operation, even on power loss (NFR-06).
- **100% offline, R$ 0/month, no paid libraries** (NFR-03, NFR-10).
- **Starts with Windows**, has a desktop shortcut, and the developer handles install and update (NFR-02, NFR-13, FR-34).
- **Writes `.xlsx` files and database backups to the local OneDrive folder.** Writes must be atomic, and the app must tolerate files locked by Excel through a retry queue (§7, FR-28 to FR-32).
- **Money as integer cents**, half-up rounding per sale, and totals that match to the cent (§5, NFR-12, CS-3).
- **Code and docs in English, UI in pt-BR** (NFR-05, NFR-11). Automated tests cover every business rule from RN-01 to RN-15 (NFR-11).
- **Frontend must reuse the stack and design system of the landing page** (`gfariasilva/desafio-color-landing-page`): Vite, React 18, TypeScript, Tailwind CSS 3, shadcn/ui (style "default", base color "slate"), Zod, react-hook-form, TanStack Query, Recharts, Vitest and npm.
- **Developer preferences:** TypeScript end-to-end, mainstream libraries, few moving parts. Clarity matters more than cleverness because the developer is learning.

## Options considered

The frontend is the same in every option: the landing page stack, pinned to the same major versions. The options differ in backend, persistence and packaging.

| | **A. Node + Fastify + better-sqlite3 + Drizzle** | **B. Node + Fastify + `node:sqlite` + Kysely** | **C. Bun, compiled to one `.exe`** |
|---|---|---|---|
| Runtime | Node.js LTS (pinned, bundled) | Node.js LTS (pinned, bundled) | Bun |
| HTTP | Fastify 5 + `@fastify/static` | Fastify 5 | Hono |
| SQLite driver | `better-sqlite3` (native module, synchronous, online backup API) | Built-in `node:sqlite` (no native module) | Built-in `bun:sqlite` |
| Queries / migrations | Drizzle ORM + drizzle-kit (generates plain `.sql` migrations) | Kysely + hand-written migrations | Drizzle |
| xlsx | ExcelJS | ExcelJS | ExcelJS |
| Validation | Zod (shared) | Zod (shared) | Zod (shared) |
| Tests | Vitest | Vitest | `bun test` / Vitest |
| Packaging | Portable `node.exe` + bundled app + Inno Setup | Same, but no native binary | Single `.exe` + Inno Setup |
| Pros | Most mainstream and best documented. The schema provides the types. Simple synchronous transactions. | Fewest moving parts, nothing to compile natively | One file to ship, fast startup |
| Cons | The native binary must match the bundled Node version and OS | `node:sqlite` is still marked experimental or release candidate. ORM support for it is immature, so expect more hand-written SQL. | Less mainstream, less mature on Windows, and diverges from the landing page's Vitest setup |

SheetJS Community Edition was rejected for xlsx: it cannot write cell styles or number formats, and its current releases are not published on npm.

## Decision

We adopt **Option A**.

### Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Runtime | Node.js **Active LTS** at setup time, pinned in `.nvmrc` and in the installer. It must have `better-sqlite3` win32-x64 prebuilds. |
| Package manager / monorepo | **npm workspaces** (same tool as the landing page) |
| HTTP server | **Fastify 5**. Plain REST + JSON. `@fastify/static` serves the built SPA. |
| Database | **SQLite** via **better-sqlite3** |
| Schema, queries, migrations | **Drizzle ORM** + **drizzle-kit**. Migrations are committed `.sql` files and run at startup. Raw SQL is allowed for reports. |
| Validation | **Zod**, with schemas in a shared package. Used by Fastify routes and by `react-hook-form` (`@hookform/resolvers`). Use the major version the landing page uses, so both repos stay aligned. |
| xlsx export | **ExcelJS** |
| Frontend | **Vite + React 18 + TypeScript + Tailwind CSS 3 + shadcn/ui**, plus TanStack Query, react-hook-form, Recharts, date-fns and lucide-react. Majors are pinned to match the landing page. Design tokens (`tailwind.config.ts`, `src/index.css`), `components.json` and `components/ui/*` are copied from the landing page. |
| Testing | **Vitest**: unit tests for `packages/core` (all RN rules), integration tests for the server with `fastify.inject()` against a temporary SQLite file. End-to-end tests (Playwright) may come later. |
| Lint / format | ESLint (flat config, like the landing page) + Prettier |
| Windows packaging | **Inno Setup** installer containing a pinned portable `node.exe`, the bundled server, the built SPA and production `node_modules` (including `better-sqlite3`'s Windows binary). Release builds are made **on Windows only**, on the developer PC or a GitHub Actions `windows-latest` runner. |
| Auto-start | **Task Scheduler** task triggered "At log on" for the owner's Windows user. It launches Node hidden (no console window) and is set to restart on failure. A Windows service is not used: it would run as another account, and the OneDrive folder belongs to the user profile. |
| Desktop shortcut | Opens `http://127.0.0.1:<port>` in the default browser |

### Repository layout

```
desafio-color-bms/
├── package.json              # npm workspaces + root scripts (dev, build, test, lint)
├── tsconfig.base.json
├── apps/
│   ├── server/               # Fastify app
│   │   ├── src/
│   │   │   ├── main.ts       # open DB, migrate, listen on 127.0.0.1
│   │   │   ├── db/           # Drizzle schema, connection + pragmas, seed (RN-12)
│   │   │   ├── modules/      # sales, expenses, cash, fixed-expenses, catalog,
│   │   │   │                 # periods (day/month lock), audit, reports, dashboards
│   │   │   ├── export/       # xlsx builders, atomic writer, export queue + retry
│   │   │   ├── backup/       # VACUUM INTO, retention (RN-13), restore
│   │   │   └── http/         # routes, error mapping, Host/Origin guard
│   │   ├── migrations/       # generated .sql (committed)
│   │   └── test/
│   └── web/                  # Vite + React + shadcn (design system from landing page)
│       └── src/{components/ui, features, lib}
├── packages/
│   └── core/                 # pure TS, no I/O: money, fee math, RN rules,
│                             # civil-date helpers, shared Zod schemas
├── installer/                # Inno Setup script, hidden launcher, scheduled task
├── .github/workflows/        # CI (lint + test) and Windows release build
└── docs/
```

Business rules RN-01 to RN-15 live in `packages/core` as pure functions, so they are easy to test exhaustively (NFR-11).

### Conventions this decision implies

- **Money:** every amount is an SQLite `INTEGER` in cents. Fee rates are integers in **percent × 10,000** (3.79% → `37900`), which allows 4 decimal places. The fee is `roundHalfUp(gross × rate / 1,000,000)` with integer arithmetic. For refunds, round the absolute value and then negate (RN-04); `Math.round` is never used on negative values. User input such as `"1.234,56"` is parsed from the string into cents, never through `parseFloat`. The worst-case intermediate value (~10¹⁵) is below 2⁵³. Zod enforces a maximum amount.
- **Dates:** business dates are `TEXT 'YYYY-MM-DD'`, the civil date in America/Sao_Paulo. Instants such as `created_at` and audit `when` are UTC ISO-8601. "Today" comes from `Intl.DateTimeFormat` with `timeZone: 'America/Sao_Paulo'`. Never use `new Date('YYYY-MM-DD')`, which parses as UTC. Excel date cells are built with `Date.UTC(y, m, d)`.
- **SQLite pragmas:** `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Transactions:** every command that writes business data writes its audit row (FR-18) in the same `better-sqlite3` transaction.
- **File locations:** the live DB is in `%LOCALAPPDATA%\ColorBMS\data\`, never inside OneDrive. The app is in `%LOCALAPPDATA%\ColorBMS\app\`. Updates replace `app\` only.

## Consequences

### Positive
- One language and one test runner (Vitest) across server, shared core and web. The frontend reuses the landing page's design system as is.
- Mainstream, well-documented libraries, which lowers the learning curve and the maintenance risk.
- Synchronous SQLite access gives simple, explicit transactions and easily meets NFR-04: a sale saves in under 1 s, and reports over 5 years of data open in under 2 s.
- Migrations are readable SQL files kept under version control.
- No runtime cost and no network dependency (NFR-03, NFR-10).

### Negative / accepted trade-offs
- **Native module:** `better-sqlite3`'s binary must match the bundled Node version and Windows x64. *Mitigation:* pin Node, build releases only on Windows, and run a smoke test (start server, write, read) in the release workflow. *Exit path:* switch the driver to `node:sqlite` (Option B) once it is stable; only `db/` changes.
- **Version lock with the landing page:** React 18, Tailwind 3 and Vite stay on the landing page's majors, and the current shadcn CLI targets Tailwind 4. *Mitigation:* add components with the Tailwind 3-compatible CLI (`shadcn@2.x`) or copy them by hand, and upgrade both repos together.
- We maintain an installer and a scheduled task ourselves, which is extra setup compared with a single executable.

### Risk handling
| Risk | Handling |
|---|---|
| Power loss mid-operation (NFR-06) | WAL + `synchronous=FULL`. All multi-row writes are transactional. |
| DB corruption from OneDrive sync | The live DB stays outside OneDrive. Backups are made with `VACUUM INTO` (or `db.backup()`) to a temp file, then renamed into `_backup-sistema/`. |
| `.xlsx` locked by Excel or OneDrive | Write a temp file in the same folder, `fsync`, then `rename`. On `EBUSY` or `EPERM`, the export queue (DB table) keeps the item, raises "Backup pendente", and retries every 5 minutes and at startup (FR-30). |
| Off-by-one dates / time zone | Civil-date strings plus explicit America/Sao_Paulo conversion (see Conventions). Official Node builds include full ICU. |
| Cent rounding drift (CS-3) | Integer math in `packages/core`, rounding per sale only. Property tests check that totals equal the sum of their parts. |
| Malicious web pages calling the local API (no login) | Bind to `127.0.0.1` only. Reject requests whose `Host` or `Origin` is not `localhost` or `127.0.0.1:<port>` (blocks DNS rebinding). Require `application/json` on writes. Never send CORS headers. |
| Second instance / port in use | On `EADDRINUSE` the launcher only opens the browser. The SQLite file lock protects the data. |
| Restore while running (FR-32) | Close the DB, back up the current file, swap in the chosen backup, reopen, run migrations, then write the audit entry. |
| Wrong PC clock affects the "no future dates" rule | Added to the deployment checklist (§9.5): confirm Windows time sync. |
| Phase 2 (LAN / mobile access) | Fastify can bind to the LAN later with an authentication hook. No change to this decision is needed. |
