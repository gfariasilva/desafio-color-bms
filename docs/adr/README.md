# Architecture Decision Records

An ADR records one significant technical decision: the context, the options we weighed, what we chose and what it costs us. Together they are the project's decision log, so anyone (including Claude) can see *why* the code looks the way it does.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-tech-stack.md) | Technical stack (Node + Fastify + better-sqlite3 + Drizzle, React shell from the landing page) | Accepted | 2026-11-18 |
| [0002](0002-e2e-tests.md) | End-to-end tests with Playwright (keyboard-only flows, CS-2 budget, Edge on Windows) | Accepted | 2026-11-18 |
| [0003](0003-pilot-backup.md) | Pilot database backup (triggers, folder setting, backup before migrations) | Proposed | 2026-11-19 |
| [0004](0004-pilot-install.md) | Pilot install (zip + scripts, Node supervisor, hidden task, trial folder) | Proposed | 2026-11-19 |

## When to write one

Write an ADR when a decision:

- adds or replaces a dependency, framework or tool that shapes the code (an ORM, an xlsx library, a test runner);
- changes how data is stored, migrated, backed up or exported;
- sets a convention that every feature must follow (money, dates, error handling, API shape);
- deviates from the spec (`docs/spec.md`) or from an earlier ADR.

Don't write one for local implementation details that a code comment explains well enough.

## How to add one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-kebab-case-title.md`, using the next free number.
2. Fill in every section and set the status to **Proposed**.
3. Add a row to the index above.
4. Open a PR. Once the owner approves it, change the status to **Accepted**.

## Rules

- **Accepted ADRs are not rewritten.** To change a decision, write a new ADR and set the old one's status to `Superseded by [NNNN](…)`. Fixing typos and adding links is fine.
- One decision per ADR.
- Write in English (project convention). Quote spec IDs (FR-xx, RN-xx, NFR-xx) where they apply.
