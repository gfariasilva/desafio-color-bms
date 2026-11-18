# MVP backlog

Ordered backlog for the MVP (spec §9.1). Each item is one small PR / GitHub issue. Items are **implemented in milestone order** (below), which puts the owner's daily routine first: the pilot replaces his **daily** spreadsheet (sales + cash closing) before the monthly features are built.

- Implement an item with `/feature #n` (or `/feature FR-xx`). Item numbers are stable IDs; the milestone order is the implementation order.
- **Acceptance criteria, business rules and other spec excerpts are copied verbatim from [`docs/spec.md`](spec.md)** (pt-BR). If the spec changes, the spec wins. Scope and notes are in English. Items #25–#27 are not in the spec; their acceptance criteria are defined here.
- Mark an item done in the index (`[x]`) in the PR that completes it.
- Questions to take to the owner: [`docs/pilot/owner-questions.md`](pilot/owner-questions.md).

## Definition of done (every item)

- Every RN and acceptance criterion listed has a passing test named after its ID (NFR-11).
- Business writes and their audit row (FR-18) happen in one transaction.
- Money in integer cents, dates as civil dates in America/Sao_Paulo, UI text in pt-BR.
- Keyboard-usable UI following `docs/design-system.md`; user flows covered by E2E tests from #4 on ([ADR 0002](adr/0002-e2e-tests.md)).
- `npm run check` and `npm run build` pass; PR uses the template, with screenshots for UI changes.

## Milestones

| Milestone | Items, in order | Outcome | Exit criterion |
|---|---|---|---|
| **M1 Sales** | #1, #2, #3, #4, #5, #6 | The owner can register, correct and refund sales with the keyboard; card fees are calculated. | Owner tries the sale form (usability check). CS-2 budget E2E test green; stopwatch check in the browser. |
| **M2 Daily cash** | #7, #8, #9, #10, #15 | The full daily cycle: expenses, withdrawals, cash closing, reopening and the day report. | Dress rehearsal: one real day typed in from paper, closed, and the day report matches the paper totals. |
| **M3 Pilot on the shop PC** | #25, #26, #27 | The system runs on the shop PC with automatic backups; trial days, reset, real start on the 1st of a month with the 2-week parallel period (§9.5). | Installed, owner trained, go-live reset done, first real day closed and backed up. |
| **M4 Drop the daily Excel** | #20, #21, #11, #12, #13 | Daily .xlsx in OneDrive and fixed expenses (incl. bills paid from the till). **Deadline: end of the 2-week parallel period.** | CS-3 held for 2 weeks and daily .xlsx files arrive in OneDrive → the owner stops his daily Excel. |
| **M5 First month end** | #14, #16, #17, #28, #22 | Month closing, month reports, monthly .xlsx and full backup/restore. **Deadline: end of the first pilot month.** | Month 1 closed in the system and matching the owner's monthly spreadsheet. |
| **M6 The rest of the MVP** | #18, #19, #23, #24 | Dashboards, all home alerts and the proper Windows installer. | MVP complete (spec §9.1); restore tested with the installer (NFR-07). |

**Timeline after go-live.** M4 and M5 have deadlines once the pilot starts: M4 before the 2-week parallel period ends, M5 before the first pilot month ends. If either slips, the fallback is to **extend the parallel period**: the owner keeps his Excel until the missing item ships. No data is lost, because the system is already the record of every day since go-live.

**Why this order.**

- #1 (audit log) comes first because every write, including master-data changes, records an audit row in the same transaction.
- #15 (day report) is in M2 because it is the comparison tool for the parallel period (CS-3).
- The pilot (M3) gets an automatic backup (#25) instead of manual copies: it runs on every day close, at startup and before every migration. Pilot updates bring migrations every week.
- The daily `.xlsx` export (#21) was split from the monthly one (#28), because §9.5 step 5 makes the system's spreadsheets the backup once the Excel is dropped (end of M4). The monthly file needs the month reports (M5).
- Fixed expenses (#11–#13) are in M4 because bills paid from the till affect the cash closing. Until then the pilot uses the interim "CONTA:" sangria rule (#9, #13).

## Index (implementation order)

| Done | Milestone | # | Item | Requirements | Depends on |
|---|---|---|---|---|---|
| [x] | M1 | [#1](#1--audit-log-foundation) | Audit log foundation | FR-18 | — |
| [x] | M1 | [#2](#2--sale-tabs-and-expense-categories) | Sale tabs and expense categories | FR-14; RN-12 | #1 |
| [x] | M1 | [#3](#3--payment-methods-card-machines-and-fee-table) | Payment methods, card machines and fee table | FR-15; RN-01, RN-12 | #1, #2 |
| [x] | M1 | [#4](#4--register-a-sale-with-the-machine-fee) | Register a sale with the machine fee | FR-01, FR-02; RN-01, RN-02, RN-03, RN-14, RN-15 | #3 |
| [x] | M1 | [#5](#5--day-view-per-tab-and-editdelete-a-sale) | Day view per tab, and edit/delete a sale | FR-05, FR-03; RN-05, RN-14 | #4 |
| [ ] | M1 | [#6](#6--refunds-estornos) | Refunds (estornos) | FR-04; RN-04 | #5 |
| [ ] | M2 | [#7](#7--general-expenses-saídas-diárias) | General expenses (saídas diárias) | FR-06; RN-08, RN-14, RN-15 | #2, #4 |
| [ ] | M2 | [#8](#8--cash-withdrawals-sangrias) | Cash withdrawals (sangrias) | FR-07; RN-14 | #4 |
| [ ] | M2 | [#9](#9--close-the-day-cash-closing) | Close the day (cash closing) | FR-08; RN-07, RN-14 | #6, #7, #8 |
| [ ] | M2 | [#10](#10--reopen-a-day) | Reopen a day | FR-09; RN-14 | #9 |
| [ ] | M2 | [#15](#15--day-report) | Day report | FR-19; RN-05, RN-07 | #9 |
| [ ] | M3 | [#25](#25--pilot-database-backup) | Pilot database backup | slice of FR-31 | #9 |
| [ ] | M3 | [#26](#26--pilot-install-on-the-shop-pc) | Pilot install on the shop PC | slice of FR-34 | #25 |
| [ ] | M3 | [#27](#27--pilot-go-live-and-the-parallel-period) | Pilot go-live and the parallel period | spec §9.5 | #26, #15 |
| [ ] | M4 | [#20](#20--settings) | Settings | FR-33 | #1 |
| [ ] | M4 | [#21](#21--daily-spreadsheet-export-and-the-retry-queue) | Daily spreadsheet export and the retry queue | FR-28, FR-30 | #15, #20 |
| [ ] | M4 | [#11](#11--fixed-expense-templates) | Fixed-expense templates | FR-10; RN-12 | #1 |
| [ ] | M4 | [#12](#12--generate-the-months-fixed-expenses) | Generate the month's fixed expenses | FR-11 | #11 |
| [ ] | M4 | [#13](#13--pay-or-dismiss-a-fixed-expense-loan-installments) | Pay or dismiss a fixed expense; loan installments | FR-12, FR-13; RN-09, RN-07, RN-14 | #12, #9 |
| [ ] | M5 | [#14](#14--close-and-reopen-the-month) | Close and reopen the month | FR-16, FR-17; RN-14 | #10, #13 |
| [ ] | M5 | [#16](#16--month-reports-income-and-general-expenses) | Month reports: income and general expenses | FR-20, FR-21; RN-06, RN-08 | #6, #7 |
| [ ] | M5 | [#17](#17--month-reports-fixed-expenses-and-monthly-summary) | Month reports: fixed expenses and monthly summary | FR-22, FR-23; RN-09, RN-10 | #13, #16 |
| [ ] | M5 | [#28](#28--monthly-spreadsheet-export) | Monthly spreadsheet export | FR-29 | #17, #21 |
| [ ] | M5 | [#22](#22--database-backup-and-restore) | Database backup and restore | FR-31, FR-32; RN-13 | #21, #25 |
| [ ] | M6 | [#18](#18--dashboard-this-month-vs-the-previous-one) | Dashboard: this month vs the previous one | FR-24; RN-11 | #17 |
| [ ] | M6 | [#19](#19--dashboards-tab-ranking-and-income--expenses) | Dashboards: tab ranking and income × expenses | FR-25, FR-26; RN-11 | #16, #17 |
| [ ] | M6 | [#23](#23--home-screen-alerts) | Home screen alerts | FR-27 | #9, #13, #21, #22 |
| [ ] | M6 | [#24](#24--windows-installer-auto-start-and-deployment-checklist) | Windows installer, auto-start and deployment checklist | FR-34 | #22, #26 |

---

## 1. Foundation and master data (cadastros)

### #1 — Audit log foundation

**Milestone:** M1 · **Requirements:** FR-18
**Depends on:** — · **Labels:** `foundation`, `auditoria`

**Goal:** Every later item writes audit rows, so the audit table, the transactional write helper and the read-only audit screen come first.

**Scope**

- `audit_log` table (when, entity, entity_id, action, before/after as JSON, reason) and its migration.
- Server helper that writes an audit row **inside the caller's transaction** (used by every write from now on).
- `GET /api/audit` with filters by date range and entity/type; read-only page "Auditoria" under Configurações.
- No update/delete endpoint for audit rows.

**Out of scope**

- Auditing each specific action: every later item adds its own audit rows and tests.

**Technical notes**

- The spec's example (sale edited from R$ 50,00 to R$ 5,00) is tested for real in #5; here use a synthetic entry.
- Store before/after as JSON text; money inside it stays in integer cents.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-18: Log de auditoria
O sistema grava automaticamente as seguintes ações:
- criação, edição e exclusão de vendas, estornos, despesas e sangrias;
- fechamento e reabertura de dias e meses;
- mudanças em categorias, taxas, maquininhas e configurações;
- restauração de backup.

Cada registro tem: data e hora, entidade, ação, valores antes e depois, e motivo (quando houver).
- **Dado** que uma venda foi editada de R$ 50,00 para R$ 5,00
  **Quando** o proprietário consulta a auditoria filtrando por data ou tipo
  **Então** vê o registro com os dois valores.
- Registros de auditoria **não podem** ser editados nem excluídos pela interface.

**Done — notes for later items**

- Call `recordAudit(tx, { entity, entityId, action, before, after, reason })` inside the business write's `db.transaction`. Money keys in `before`/`after` end in `Cents`.
- Add pt-BR labels for new `before`/`after` fields to `AUDIT_FIELD_LABELS` in `packages/core/src/audit/audit.ts`; unknown fields are shown by their key.
- Immutability is enforced by the API (no edit/delete routes), not by a database trigger (owner's decision).

### #2 — Sale tabs and expense categories

**Milestone:** M1 · **Requirements:** FR-14; RN-12
**Depends on:** #1 · **Labels:** `cadastros`

**Goal:** The owner can manage sale tabs (abas) and general-expense categories, seeded with the initial lists.

**Scope**

- Tables for sale categories and expense categories (group `Geral` | `Fornecedores de materiais`), with order and active flag.
- Seed from RN-12 (9 abas, expense categories and the Fornecedores group).
- Create, rename, deactivate/reactivate, reorder; delete only if never used; case-insensitive unique names per type.
- Page "Cadastros" › Abas de venda / Categorias de despesa. Audit every change (FR-18).

**Out of scope**

- Payment methods, card machines and fee table (#3).
- Fixed-expense templates (#11).

**Technical notes**

- "Never used" will be checked against sales/expenses once those tables exist; add the check in #4/#7 if the tables are not there yet.
- Category colors: `categoryColor(order)` from the design system.

**Done notes (follow-ups)**

- Names are unique ignoring **case and accents** (owner decision): `categoryNameKey()` in `packages/core/src/catalog/categories.ts`, stored in a unique `name_key` column.
- RN-12 lists are seeded by the migration `0003_seed_categories.sql`, so they run once and deleted categories never come back.
- **#4** must add the sales count to `countUsages()` in `apps/server/src/modules/categories/categories.repository.ts`, replace the `it.todo` in `apps/server/test/categories.test.ts` (delete a used tab → 409 `category_in_use`), and test the FR-14 rename criterion with real sales. The sale form lists tabs with `GET /api/sale-categories?active=true`.
- **#7** does the same for expense categories (`GET /api/expense-categories?active=true`).
- Auditoria shows a category's id in "Registro", not its name; consider showing the name when audit rows gain a display label.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-14: Gerenciar categorias (abas de venda e categorias de despesa)
O proprietário pode **criar, renomear, desativar, reativar e reordenar** categorias. A **exclusão** só é permitida se a categoria nunca foi usada.
- **Dado** a aba "Serviços de copiadora" com vendas registradas
  **Quando** o proprietário a renomeia para "Cópias e impressões"
  **Então** todas as vendas, inclusive as antigas, aparecem sob o novo nome, e os totais históricos não mudam.
- **Dado** uma categoria com lançamentos
  **Quando** o proprietário tenta excluí-la
  **Então** o sistema bloqueia e oferece **desativar**.
- **Dado** uma categoria desativada
  **Quando** o proprietário registra uma venda ou despesa
  **Então** ela não aparece na lista, mas continua nos relatórios e exportações dos períodos em que teve movimento.
- **Dado** um nome já usado por outra categoria do mesmo tipo
  **Quando** o proprietário tenta criar ou renomear para esse nome
  **Então** o sistema bloqueia (sem diferenciar maiúsculas e minúsculas).

**Business rules** _(verbatim from spec §5)_

**RN-12: Cadastros iniciais.**
- **Abas de venda (9):** Acessórios, Carimbos, Cartuchos compatíveis, Recargas, Papelaria, Chaveiro, Toner, Serviços de copiadora, Personalizados.
- **Formas de pagamento:** Dinheiro, Cartão de débito, Cartão de crédito, PIX/Depósito, Boleto bancário.
- **Maquininhas:** PagSeguro, Mercado Pago (taxas a preencher, ver Q-01).
- **Categorias de despesa geral:** Acessórios, Carimbos, Chaves, Despesas gerais (loja), Despesas moto, Abastecimento moto, Diversos, Alimentação.
  - **Grupo Fornecedores de materiais:** Casa Forte, Nova Supri, Canal Verde, Jandaia, Kalunga, Suzano, Outros fornecedores.
- **Modelos de despesa fixa:** conforme FR-10.

### #3 — Payment methods, card machines and fee table

**Milestone:** M1 · **Requirements:** FR-15; RN-01, RN-12
**Depends on:** #1, #2 · **Labels:** `cadastros`, `core`

**Goal:** The fee table exists and is valid, so sales can look up the fee in force (RN-01).

**Scope**

- Tables: payment methods (machine usage: required/optional/not applicable; allows installments), card machines, fee rates (machine × method × installment range, rate, valid from).
- Seed from RN-12 (5 payment methods, PagSeguro and Mercado Pago; rates left empty until Q-01 is answered).
- Core: `findFeeInForce()` (RN-01) and overlap validation of installment ranges.
- Page "Cadastros" › Maquininhas, Formas de pagamento, Taxas. Audit every change.

**Out of scope**

- Applying the fee to a sale (#4).

**Technical notes**

- Store the rate as an integer: percent × 10,000 (3,79% → 37900), as ADR 0001 says.
- `vigente_desde` is a civil date ("YYYY-MM-DD").

**Done notes (follow-ups)**

- Rates are stored as `ratePpm` (percent × 10,000 = parts per million); `parseRatePercent()` / `formatRatePercent()` in `packages/core/src/payments/rate.ts`. Fields ending in `Ppm` are shown as % in Auditoria.
- Payment methods carry `machineUsage` (`required` | `optional` | `not_applicable`) and `allowsInstallments`; the sale form must read these flags instead of hard-coding "Crédito"/"Dinheiro". Seeded by `0005_seed_payments.sql` (PIX with an optional machine, Q-03 assumption). No rates are seeded (Q-01).
- A machine or method with fee rows counts as **used** (delete → 409 `category_in_use`, the screen offers Desativar). **#4** must add its sales to `countUsages()` in `apps/server/src/modules/payments/payment-lists.repository.ts`, and replace the `it.todo` in `apps/server/test/payments.test.ts`.
- Overlap = same machine, method and "vigente desde" with intersecting ranges; other dates are versions picked per installment count by RN-01 (`findFeeInForce`).
- **#4** gets the fee with `GET /api/card-fees/in-force?cardMachineId&paymentMethodId&installments&date` (`{ fee }` or `{ fee: null }`), or calls `findCardFeeInForce()` in the server. The "atalho para a tabela de taxas" in the FR-01 error links to `/cadastros/taxas`.
- Fee rows can be edited and deleted (sales never reference them, spec §6.1). Changing a method's machine usage or installments is allowed; rows that no longer apply simply stop being used.
- Fee rows of an inactive machine or method, or of a method that no longer uses a machine, never apply: `GET /api/card-fees/in-force` returns `{ fee: null }` and the screen shows them as **Sem uso** (`isCardFeeUsable()` in core).
- Follow-up: `payment-lists.repository.ts` still repeats the list logic of `categories.repository.ts` (select, reorder, delete, order gap); a shared list engine for the four lists would remove the copy.
- The list endpoints of all four lists come from `registerOrderedListRoutes()` in `apps/server/src/http/ordered-list-routes.ts`. `parseOr400`, `parseId`, `BusinessError` and `sendError` moved to `apps/server/src/http/route-helpers.ts`; `CategoryManager` became `CatalogListManager` (4 lists) and `CategoriesPage` became `CatalogListPage`.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-15: Gerenciar maquininhas, formas de pagamento e tabela de taxas
- As maquininhas e formas de pagamento seguem as mesmas regras de FR-14.
- A **tabela de taxas** tem uma linha por maquininha × forma × faixa de parcelas, com percentual e "vigente desde".

- **Dado** a taxa PagSeguro / Crédito / 2–6x de 4,99% desde 01/01/2026
  **Quando** o proprietário cadastra 4,59% vigente desde 01/12/2026
  **Então** vendas até 30/11 usam 4,99%, e vendas a partir de 01/12 usam 4,59%.
- **Dado** que duas faixas de parcelas se sobrepõem para a mesma maquininha, forma e data
  **Quando** o proprietário tenta salvar
  **Então** o sistema bloqueia.
- **Dado** uma nova maquininha "Stone"
  **Quando** o proprietário a cadastra e informa suas taxas
  **Então** ela fica disponível no lançamento de vendas, sem mudança no código.

**Business rules** _(verbatim from spec §5)_

**RN-01: Taxa vigente.** A taxa de uma venda é o registro da tabela de taxas que atende a todas as condições abaixo. Se não houver nenhum, a venda é bloqueada (FR-01).
- mesma maquininha e forma de pagamento;
- parcelas dentro da faixa;
- **maior "vigente desde" ≤ data da venda**.

**RN-12: Cadastros iniciais.**
- **Abas de venda (9):** Acessórios, Carimbos, Cartuchos compatíveis, Recargas, Papelaria, Chaveiro, Toner, Serviços de copiadora, Personalizados.
- **Formas de pagamento:** Dinheiro, Cartão de débito, Cartão de crédito, PIX/Depósito, Boleto bancário.
- **Maquininhas:** PagSeguro, Mercado Pago (taxas a preencher, ver Q-01).
- **Categorias de despesa geral:** Acessórios, Carimbos, Chaves, Despesas gerais (loja), Despesas moto, Abastecimento moto, Diversos, Alimentação.
  - **Grupo Fornecedores de materiais:** Casa Forte, Nova Supri, Canal Verde, Jandaia, Kalunga, Suzano, Outros fornecedores.
- **Modelos de despesa fixa:** conforme FR-10.

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-01 | Quais são as **taxas atuais** da PagSeguro e da Mercado Pago, por forma (débito, crédito à vista, crédito 2–12x, PIX pela maquininha)? Há tarifa fixa por transação, além do %? | Sem elas não é possível registrar vendas no cartão (RN-01). | Bloqueio até o cadastro. Apenas taxa %. |
| Q-02 | O senhor usa **antecipação** de recebíveis? | Muda a taxa efetiva. | Não usa. Se usar, a antecipação entra embutida no % cadastrado. |

---

## 2. Sales (vendas)

### #4 — Register a sale with the machine fee

**Milestone:** M1 · **Requirements:** FR-01, FR-02; RN-01, RN-02, RN-03, RN-14, RN-15
**Depends on:** #3 · **Labels:** `vendas`, `core`

**Goal:** The owner registers a sale in ≤ 10 s with the keyboard, and the fee and net value are calculated and stored on the sale.

**Scope**

- Tables: `sales` (type sale/refund) plus the period tables `days` and `months` (status open/closed). Nothing closes them yet; #9 and #14 do.
- Core: fee and net calculation (RN-02, RN-03) with half-up rounding per sale; date rules (no future dates, RN-15); lock check (RN-14).
- `POST /api/sales` stores the rate percentage, fee and net **copied onto the sale** (FR-02).
- Page "Vendas": keyboard-first form (valor → aba → forma → Enter), keeps the date, focus back on the value field; today's sales list.
- Parse "1.234,56" into cents without floats (core helper + tests).
- Keystroke-efficient choice of tab and payment method (type-ahead or digit shortcuts, never mouse-only dropdowns), so a typical cash sale fits the E2E keystroke budget.
- **E2E test setup** as described in [ADR 0002](adr/0002-e2e-tests.md): `e2e/` folder, `npm run e2e`, per-worker server with a temp data folder, test clock `COLOR_BMS_NOW` (test mode only), CI steps.
- E2E tests: keyboard-only sale flow (no clicks after page load), missing-fee / closed-day / future-date errors, and the CS-2 budget test.

**Out of scope**

- Editing/deleting (#5), refunds (#6), the per-tab day view (#5).

**Technical notes**

- Test the RN-03 example exactly: R$ 150,00 at 3,79% → fee R$ 5,69, net R$ 144,31.
- Error text for a missing fee must match FR-01 and link to the fee table.
- CS-2 is automated as a budget (ADR 0002): ≤ 12 keystrokes for a typical sale, each save < 1 s (NFR-04), 10 sales at ~250 ms per key in ≤ 100 s. The stopwatch test with the owner happens in #27.

**Done notes (follow-ups)**

- Tables `sales`, `days` and `months` (migration `0006_create_sales_and_periods.sql`). No row in `days`/`months` means **open**; #9 and #14 write the rows. `sales` already has `type`, `original_sale_id` and `reason` for refunds (#6), and a CHECK `net = gross − fee`.
- Core: `parseMoneyToCents()` (max `MAX_SALE_CENTS` = R$ 999.999,99, owner decision), `calculateSaleAmounts()` (RN-02/03; negatives round half away from zero, so a full refund mirrors its sale — #6 relies on this), and the FR-01 rules in `packages/core/src/sales/sale-rules.ts` (`saleDateError`, `periodLockError`, `saleMachineError`, `resolveInstallments`, `missingFeeMessage`).
- API: `POST /api/sales` (409 `day_closed` / `card_fee_missing`), `GET /api/sales?date=` (with tab/method/machine names), `GET /api/today`. Sales without installments store `installments: null` and are looked up as 1x.
- Server time comes from `apps/server/src/clock.ts` (`COLOR_BMS_NOW` only with `NODE_ENV=test`); `buildApp({ now })` takes it. Other modules still default to `new Date()` for their audit time; move them to the clock when touched.
- Tabs, payment methods and card machines used by sales can no longer be deleted (`countUsages()`), only deactivated.
- E2E: `npm run e2e` (workspace `e2e/`). Until #9 exists, the closed-day test writes the `days` row straight into the worker's SQLite file (`closeDay()` in `e2e/tests/fixtures.ts`); **#9** should switch it to the API.
- **#5** builds the per-tab day view on `GET /api/sales?date=`; the Vendas page currently shows a flat list with the day total.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-01: Registrar venda
O sistema deve permitir registrar uma venda com os campos abaixo.

| Campo | Regras |
|---|---|
| Data | Padrão: hoje. Datas futuras não são aceitas. O dia não pode estar fechado. |
| Aba | Obrigatória. Apenas abas ativas. |
| Forma de pagamento | Obrigatória. Apenas formas ativas. |
| Maquininha | Obrigatória para Débito e Crédito. Opcional para PIX (PIX pela maquininha). Não se aplica a Dinheiro e Boleto. |
| Parcelas | Apenas para Crédito, de 1 a 12. Padrão: 1. |
| Valor bruto | Obrigatório, maior que 0. |
| Observação | Opcional. |

Uma venda tem exatamente **uma aba e uma forma de pagamento**. Pagamento dividido e compra de várias abas são registrados como várias vendas.

- **Dado** que o dia 18/11/2026 está aberto e existe taxa cadastrada para Mercado Pago / Crédito / 3x
  **Quando** o proprietário registra uma venda de R$ 150,00 em "Toner", Crédito, Mercado Pago, 3x
  **Então** a venda é salva com o valor bruto, o percentual da taxa vigente, o valor da taxa e o valor líquido (RN-01 a RN-03), e aparece na aba "Toner" do dia.
- **Dado** um dia fechado
  **Quando** o proprietário tenta registrar uma venda nessa data
  **Então** o sistema bloqueia e informa que o dia precisa ser reaberto (FR-09).
- **Dado** que não existe taxa vigente para a combinação maquininha/forma/parcelas na data da venda
  **Quando** o proprietário tenta salvar
  **Então** o sistema bloqueia e mostra "Cadastre a taxa de <maquininha> / <forma> / <n>x antes de registrar esta venda", com atalho para a tabela de taxas.
- **Dado** a tela de lançamento aberta
  **Quando** o proprietário registra uma venda usando apenas o teclado (valor → aba → forma → Enter)
  **Então** a venda é salva e o formulário fica pronto para a próxima, mantendo a data. O fluxo deve permitir cumprir o CS-2 (≤ 10 s).

#### FR-02: Calcular taxa e valor líquido
O sistema deve calcular e **gravar na própria venda** o percentual aplicado, o valor da taxa e o valor líquido, segundo RN-01 a RN-03.
- **Dado** que a taxa Mercado Pago / Débito era 1,99% até 31/10 e passou a 1,49% em 01/11
  **Quando** uma venda de outubro é consultada ou editada
  **Então** ela mantém 1,99%. Mudanças posteriores na tabela de taxas nunca recalculam vendas já salvas, exceto se a própria venda for editada (FR-03), quando vale a taxa vigente na data da venda.

**Business rules** _(verbatim from spec §5)_

**Valores monetários:** são armazenados em **centavos inteiros**, sem ponto flutuante. Todos os arredondamentos usam **meio para cima** (0,005 → 0,01), sempre por venda, nunca sobre totais.

**RN-01: Taxa vigente.** A taxa de uma venda é o registro da tabela de taxas que atende a todas as condições abaixo. Se não houver nenhum, a venda é bloqueada (FR-01).
- mesma maquininha e forma de pagamento;
- parcelas dentro da faixa;
- **maior "vigente desde" ≤ data da venda**.

**RN-02: Valor da taxa.** `taxa_valor = arredondar(valor_bruto × taxa_percentual ÷ 100; 2 casas)`. Para Dinheiro, Boleto e PIX sem maquininha, `taxa_percentual = 0` e `taxa_valor = 0`.

**RN-03: Valor líquido.** `valor_liquido = valor_bruto − taxa_valor`.
*Exemplo:* R$ 150,00 a 3,79% → taxa R$ 5,69 (5,685 arredondado), líquido R$ 144,31.

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

**RN-15: Datas.**
- Não são aceitos lançamentos com data futura, com uma exceção: o vencimento de despesa fixa pode ser futuro.
- O "dia" é o dia civil em America/Sao_Paulo.

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-03 | **PIX:** o cliente paga pela maquininha (com taxa), direto na conta (sem taxa), ou os dois? **Boleto:** quem emite, há tarifa, e o boleto conta na data da venda ou na data do pagamento? | Taxa e data da entrada. | PIX: as duas opções, com maquininha opcional. Boleto: sem taxa e contado na data da venda. |
| Q-09 | Em "Personalizados", há **sinal** (adiantamento) e restante pago depois? | Como registrar. | Cada pagamento é registrado como uma venda na data em que é recebido. |

### #5 — Day view per tab, and edit/delete a sale

**Milestone:** M1 · **Requirements:** FR-05, FR-03; RN-05, RN-14
**Depends on:** #4 · **Labels:** `vendas`

**Goal:** The owner sees the day organised by tab with subtotals, and can correct sales while the day is open.

**Scope**

- Core: day totals per tab × payment method (gross, fee, net) (RN-05).
- `GET /api/days/:date/sales` (grouped), `PATCH`/`DELETE /api/sales/:id` with an audit row holding before/after.
- Edit recalculates with the fee in force on the sale date (FR-02). Blocked on closed days (RN-14).
- Tabs without sales show R$ 0,00 and can be collapsed.

**Out of scope**

- Refunds (#6).

**Technical notes**

- Totals are always computed from the rows, never stored (spec §6.3).

**Done notes (follow-ups)**

- No schema change. Core: `summarizeDaySales()` (RN-05; all active tabs in display order, inactive ones only with sales that day, method subtotals in method order), `saleChangeLockError()` (FR-03 text: reopen the day or register a refund), `updateSaleInputSchema` (partial, "Nada para alterar."), `daySalesResponseSchema`, `formatMoneyInput()` (cents → "1.234,56" for the form).
- API: `GET /api/days/:date/sales` (grouped, with `lock` message), `PATCH /api/sales/:id` (merged into the saved sale, then the same FR-01 checks as `POST` via `checkAndPrice()`; the fee in force on the sale date is applied on **every** edit, FR-02 — owner-approved), `DELETE /api/sales/:id` (204). Both 409 `day_closed` on the old or new date. An edit may keep a tab/method/machine deactivated since; new choices must be active. An edit that changes nothing writes no audit row.
- **#6:** `PATCH`/`DELETE` reject refund rows (400) and sales that already have refunds (409 `sale_has_refunds`). Revisit both when refunds exist (e.g. whether a refund can be deleted on an open day). The day view already adds refunds in (negative rows) and hides Editar/Excluir on them.
- UI: the Vendas page shows the day per tab (`components/sales/DaySalesView.tsx`); "Editar" loads the sale into the same form, "Excluir" uses `window.confirm`. On a closed day both show the lock message without calling the server.
- Possible follow-up for the owner's usability check: an option to hide empty tabs entirely (today they are collapsed one-line headers at R$ 0,00).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-05: Ver o dia por aba
O sistema deve exibir, para a data selecionada, cada aba com:
- a lista de vendas e estornos;
- o subtotal de cada forma de pagamento (bruto, taxa, líquido);
- o total da aba;
- o **total do dia**.

- **Dado** vendas em 3 abas no dia
  **Quando** o proprietário abre o dia
  **Então** vê as 3 abas com seus totais por forma, e as abas sem movimento aparecem com total R$ 0,00 (podendo ser recolhidas).

#### FR-03: Editar ou excluir venda em dia aberto
- **Dado** uma venda em um dia **aberto**
  **Quando** o proprietário altera um campo ou exclui a venda
  **Então** a alteração é aplicada, os totais são recalculados e um registro é gravado no log de auditoria (FR-18) com os valores antes e depois.
- **Dado** uma venda em um dia **fechado**
  **Quando** o proprietário tenta editá-la ou excluí-la
  **Então** o sistema bloqueia e sugere reabrir o dia ou registrar um estorno (FR-04).

**Business rules** _(verbatim from spec §5)_

**RN-05: Totais do dia.**
- Total da aba, por forma = Σ (vendas + estornos) dessa aba e forma no dia, separadamente para bruto, taxa e líquido.
- Total da aba = Σ formas.
- Total do dia = Σ abas.

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

### #6 — Refunds (estornos)

**Milestone:** M1 · **Requirements:** FR-04; RN-04
**Depends on:** #5 · **Labels:** `vendas`, `core`

**Goal:** The owner refunds all or part of a sale from an earlier day without changing the closed day.

**Scope**

- Core: refund amounts (RN-04): negative gross, same rate, proportional negative fee, net = gross − fee; Σ refunds ≤ original gross.
- `POST /api/sales/:id/refunds` with a required reason; creates a `refund` row **today**, linked to the original sale.
- UI: select a sale (search by date) → refund amount + reason.

**Out of scope**

- Cash-closing effect: it is covered by RN-07 in #9 (test it there).

**Technical notes**

- Round the absolute value, then negate (never `Math.round` on negatives).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-04: Registrar estorno
O sistema deve permitir estornar, total ou parcialmente, uma venda de um dia anterior.
- **Dado** uma venda de R$ 80,00 em 10/11 (dia fechado), Débito, PagSeguro
  **Quando** o proprietário seleciona a venda e registra um estorno de R$ 80,00 com o motivo "produto com defeito"
  **Então** é criado em **hoje** (dia aberto) um lançamento do tipo estorno com valor bruto −R$ 80,00, mesma aba, forma, maquininha e parcelas, taxa e líquido negativos proporcionais (RN-04), ligado à venda original. A venda original não muda.
- **Dado** uma venda de R$ 80,00 que já teve R$ 50,00 estornados
  **Quando** o proprietário tenta estornar mais R$ 40,00
  **Então** o sistema bloqueia (a soma dos estornos não pode passar do valor original).
- **Dado** um estorno em dinheiro
  **Quando** o caixa do dia é fechado
  **Então** o valor estornado reduz o dinheiro esperado (RN-07).
- O **motivo** é obrigatório.

**Business rules** _(verbatim from spec §5)_

**RN-04: Estorno.**
- `valor_bruto_estorno = −valor_estornado`.
- O percentual é o mesmo da venda original.
- `taxa_valor_estorno = −arredondar(valor_estornado × taxa_percentual_original ÷ 100; 2)`.
- `líquido = bruto − taxa`.
- A soma dos estornos de uma venda não pode passar do valor bruto original.
- Premissa: a maquininha devolve a taxa proporcional (ver Q-04).

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-04 | Quando a venda no cartão é **estornada**, a maquininha devolve a taxa? | Valor líquido do estorno (RN-04). | Devolve proporcionalmente. |

---

## 3. Expenses and cash (despesas e caixa)

### #7 — General expenses (saídas diárias)

**Milestone:** M2 · **Requirements:** FR-06; RN-08, RN-14, RN-15
**Depends on:** #2, #4 · **Labels:** `despesas`

**Goal:** The owner records day-to-day expenses by category, marking those paid with cash from the till.

**Scope**

- `expenses` table with type `geral` | `fixa`, built to be shared with fixed expenses (#11–#13); `geral` rows are born `pago`.
- Fixed list of payment means (A-14): Dinheiro, PIX, Cartão, Boleto, Transferência/Débito em conta; "pago do caixa" only for Dinheiro (default yes).
- Create/edit/delete with audit and lock rules; page "Despesas" with the day's expenses.

**Out of scope**

- Fixed expenses (#11–#13).

**Technical notes**

- Design the `expenses` columns once using spec §6.1 (Despesa) so #12/#13 need only additive migrations.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-06: Registrar despesa geral (saída diária)
| Campo | Regras |
|---|---|
| Data de pagamento | Padrão: hoje. Não pode cair em dia fechado. Datas futuras não são aceitas. |
| Categoria | Obrigatória. Apenas categorias de despesa geral ativas. |
| Descrição | Opcional. |
| Valor | Obrigatório, maior que 0. |
| Meio de pagamento | Dinheiro, PIX, Cartão, Boleto ou Transferência/Débito em conta. |
| Pago com dinheiro do caixa? | Só quando o meio é Dinheiro. Padrão: sim. |

- **Dado** o dia de hoje aberto
  **Quando** o proprietário lança R$ 45,00 em "Abastecimento moto", Dinheiro, pago do caixa
  **Então** a despesa aparece nas saídas do dia, entra no total de despesas gerais do mês (RN-08) e reduz o dinheiro esperado no fechamento (RN-07).
- **Dado** uma despesa paga por PIX
  **Quando** o caixa é fechado
  **Então** ela **não** afeta o dinheiro esperado.
- Edição e exclusão seguem as mesmas regras de FR-03, com registro na auditoria.

**Business rules** _(verbatim from spec §5)_

**Valores monetários:** são armazenados em **centavos inteiros**, sem ponto flutuante. Todos os arredondamentos usam **meio para cima** (0,005 → 0,01), sempre por venda, nunca sobre totais.

**RN-08: Despesas gerais do mês.** Σ valor das despesas do tipo geral cuja **data de pagamento** cai no mês. Cada despesa pertence a **exatamente uma categoria**, e as categorias são independentes (ex.: uma compra na Kalunga vai para "Kalunga" **ou** para "Acessórios", nunca para as duas).

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

**RN-15: Datas.**
- Não são aceitos lançamentos com data futura, com uma exceção: o vencimento de despesa fixa pode ser futuro.
- O "dia" é o dia civil em America/Sao_Paulo.

### #8 — Cash withdrawals (sangrias)

**Milestone:** M2 · **Requirements:** FR-07; RN-14
**Depends on:** #4 · **Labels:** `despesas`, `caixa`

**Goal:** The owner records cash taken out of the till; it is not an expense.

**Scope**

- `cash_withdrawals` table; create/edit/delete with audit and lock rules.
- Shown on the "Despesas" page in its own section, clearly labelled as not an expense.

**Technical notes**

- Never include withdrawals in expenses or in the monthly balance (RN-10).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-07: Registrar sangria
- **Dado** o dia de hoje aberto
  **Quando** o proprietário registra uma sangria de R$ 300,00 com a observação "depósito no banco"
  **Então** a sangria reduz o dinheiro esperado do dia e **não** entra em despesas nem no saldo mensal.

**Business rules** _(verbatim from spec §5)_

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-08 | Existe **suprimento** de caixa (colocar dinheiro no caixa durante o dia, além do troco inicial)? | Fórmula do caixa (RN-07). | Não existe. |

### #9 — Close the day (cash closing)

**Milestone:** M2 · **Requirements:** FR-08; RN-07, RN-14
**Depends on:** #6, #7, #8 · **Labels:** `caixa`, `core`

**Goal:** The owner closes the day in ≤ 3 minutes: the system shows the expected cash, records the counted cash and the difference, and locks the day.

**Scope**

- Core: expected cash and difference (RN-07), including cash refunds and expenses paid from the till.
- Closing screen: opening cash (pre-filled from the last count, A-12; empty on the first day), cash sales, expenses from the till, withdrawals, expected, counted, difference highlighted, optional note.
- `POST /api/days/:date/close` stores expected/counted/difference and locks the day; audit row.
- Pilot slice of FR-27: Início warns about earlier days left open (spec condition: "Dia anterior a hoje com movimento e status aberto."), with a link to close each one. #23 later folds it into the full alert list.
- Add the closing to the E2E suite (keyboard-only closing of a day with cash sales, an expense from the till and a withdrawal).

**Out of scope**

- Enqueueing the spreadsheet exports and the DB backup: the closing calls an `onDayClosed` hook point; the pilot backup is wired in #25, the daily export in #21.

**Technical notes**

- Measure CS-4 (≤ 3 min) manually.
- Interim rule until #13 ships: a fixed bill paid with cash from the till is recorded as a sangria with an observation starting with "CONTA:" (see #13).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-08: Fechar o dia (fechamento de caixa)
- **Dado** um dia aberto com movimento
  **Quando** o proprietário inicia o fechamento
  **Então** o sistema mostra:
  - troco inicial: pré-preenchido com o dinheiro contado no último fechamento, editável;
  - vendas em dinheiro do dia (líquidas de estornos);
  - despesas pagas do caixa;
  - sangrias;
  - **dinheiro esperado** (RN-07);
  - campo para o **dinheiro contado**.
- **Dado** que o proprietário informa o dinheiro contado e confirma
  **Quando** o fechamento é gravado
  **Então**:
  - o dia passa a **fechado**;
  - a **diferença** (RN-07) é gravada;
  - a exportação da **planilha diária** e a atualização da **planilha mensal** entram na fila (FR-28, FR-29);
  - um **backup do banco** é gerado (FR-31).
- **Dado** que a diferença é diferente de R$ 0,00
  **Quando** o fechamento é confirmado
  **Então** o sistema mostra a diferença em destaque (sobra ou falta), pede uma observação opcional e permite fechar mesmo assim.
- **Dado** o primeiro dia de uso do sistema
  **Quando** o proprietário fecha o dia
  **Então** o troco inicial vem vazio e deve ser digitado.

**Business rules** _(verbatim from spec §5)_

**RN-07: Fechamento de caixa.**
```
Dinheiro esperado = Troco inicial
                  + Σ vendas em Dinheiro do dia (estornos em dinheiro já negativos)
                  − Σ despesas (gerais e fixas) pagas em Dinheiro com "pago do caixa = sim" na data
                  − Σ sangrias do dia
Diferença = Dinheiro contado − Dinheiro esperado   (>0 sobra, <0 falta)
```

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

### #10 — Reopen a day

**Milestone:** M2 · **Requirements:** FR-09; RN-14
**Depends on:** #9 · **Labels:** `caixa`

**Goal:** The owner can reopen a closed day (with a reason) while its month is open.

**Scope**

- `POST /api/days/:date/reopen` with a reason; the previous closing goes to the audit log; a new closing is required.
- Blocked when the month is closed (message pointing to FR-17).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-09: Reabrir o dia
- **Dado** um dia fechado em um mês **aberto**
  **Quando** o proprietário escolhe "Reabrir dia", confirma e informa um motivo
  **Então** o dia volta a aberto, o fechamento anterior fica no log de auditoria, e um novo fechamento será exigido (FR-08), gerando de novo a planilha diária.
- **Dado** um dia de um mês **fechado**
  **Quando** o proprietário tenta reabri-lo
  **Então** o sistema informa que é preciso reabrir o mês antes (FR-17).

**Business rules** _(verbatim from spec §5)_

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

---

## 4. Fixed expenses (despesas fixas)

### #11 — Fixed-expense templates

**Milestone:** M4 · **Requirements:** FR-10; RN-12
**Depends on:** #1 · **Labels:** `despesas-fixas`, `cadastros`

**Goal:** The owner maintains the list of monthly bills (templates) with due day and expected amount.

**Scope**

- `fixed_expense_templates` table; seed from FR-10's initial list (Gerais, Taxas governo).
- Create, edit, deactivate, reorder; loans with total and remaining installments.
- Page "Despesas fixas" › Modelos. Audit every change.

**Out of scope**

- Generating the month (#12).

**Technical notes**

- The salary amount is personal data (NFR-09): store it only locally, nothing more is needed.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-10: Manter modelos de despesa fixa
O proprietário pode cadastrar, editar, desativar e reordenar **modelos** de despesa fixa:
- nome;
- grupo (Gerais ou Taxas governo);
- subgrupo opcional (ex.: Telefonia);
- dia de vencimento (1–31);
- valor previsto (opcional);
- ativo (sim/não);
- para Empréstimos: total de parcelas e parcelas restantes.

Carga inicial (ver RN-12):
- **Gerais:** Água, Luz, Aluguel, Contador, Funcionário, GPS, Seguro loja, Telefonia – Vivo fixo, Telefonia – Vivo móvel, Banco, Empréstimos.
- **Taxas governo:** DAS, DARE, DARF, TFE.

- **Dado** um modelo desativado
  **Quando** o próximo mês é gerado
  **Então** nenhum lançamento é criado para ele, e os lançamentos passados continuam nos relatórios.

**Business rules** _(verbatim from spec §5)_

**RN-12: Cadastros iniciais.**
- **Abas de venda (9):** Acessórios, Carimbos, Cartuchos compatíveis, Recargas, Papelaria, Chaveiro, Toner, Serviços de copiadora, Personalizados.
- **Formas de pagamento:** Dinheiro, Cartão de débito, Cartão de crédito, PIX/Depósito, Boleto bancário.
- **Maquininhas:** PagSeguro, Mercado Pago (taxas a preencher, ver Q-01).
- **Categorias de despesa geral:** Acessórios, Carimbos, Chaves, Despesas gerais (loja), Despesas moto, Abastecimento moto, Diversos, Alimentação.
  - **Grupo Fornecedores de materiais:** Casa Forte, Nova Supri, Canal Verde, Jandaia, Kalunga, Suzano, Outros fornecedores.
- **Modelos de despesa fixa:** conforme FR-10.

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-05 | Quais despesas fixas são realmente **mensais**, e qual o **dia de vencimento** de cada uma? (TFE, por exemplo, costuma ser anual.) "Telefonia" inclui algo além de Vivo fixo e Vivo móvel? | Geração do mês e alertas (FR-11). | Todas mensais. As que não se aplicam no mês são marcadas como "dispensado". |
| Q-06 | Quantos **empréstimos** estão ativos, com quantas parcelas restantes e qual o valor? | Carga inicial (FR-13). | Cadastro na implantação. |

### #12 — Generate the month's fixed expenses

**Milestone:** M4 · **Requirements:** FR-11
**Depends on:** #11 · **Labels:** `despesas-fixas`, `core`

**Goal:** Each month's bills are created automatically, once, from the active templates.

**Scope**

- Core: due date for the month (last day of the month when the day does not exist).
- Idempotent generation when the system opens in a month not yet generated (`months.fixed_expenses_generated`).
- Loans with 0 remaining installments: no entry, template deactivated.
- Manual one-off fixed entry for the month.

**Out of scope**

- Paying (#13).

**Technical notes**

- Run the generation in one transaction at startup and on first request of a new month; test with a fixed `today`.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-11: Gerar as despesas fixas do mês
- **Dado** que o mês M ainda não tem despesas fixas geradas
  **Quando** o sistema é aberto em qualquer dia do mês M
  **Então** é criado, para cada modelo ativo, um lançamento com:
  - mês de referência M;
  - vencimento no dia configurado (ou no último dia do mês, se o dia não existir);
  - valor previsto;
  - status **pendente**.
- **Dado** que o mês M já foi gerado
  **Quando** o sistema é aberto de novo
  **Então** nada é duplicado.
- **Dado** um modelo de Empréstimo com 0 parcelas restantes
  **Quando** o mês é gerado
  **Então** nenhum lançamento é criado, e o modelo é desativado automaticamente.
- O proprietário também pode **adicionar manualmente** um lançamento fixo avulso no mês.

### #13 — Pay or dismiss a fixed expense; loan installments

**Milestone:** M4 · **Requirements:** FR-12, FR-13; RN-09, RN-07, RN-14
**Depends on:** #12, #9 · **Labels:** `despesas-fixas`, `caixa`

**Goal:** The owner marks bills as paid (cash basis) or dismissed, and loan installments count down.

**Scope**

- Pay: amount, payment date, payment means, paid from the till; status `pago`; counts in the month of the **payment date** (RN-09).
- Dismiss: status `dispensado`, excluded from alerts and totals.
- Paid from the till reduces the expected cash of that day (RN-07): extend #9's calculation and its tests.
- Loans: remaining installments decrease on payment; show "parcela n de N".
- One-off conversion of the pilot's interim records: sangrias whose observation starts with "CONTA:" become paid fixed expenses (same date and amount, paid in cash from the till), with an audit row each. The owner confirms each one on screen.

**Technical notes**

- Payment date cannot fall on a closed day (A-16).
- RN-14 still applies to the conversion: the screen reopens the day (FR-09, reason pre-filled "Conversão CONTA: piloto"), converts, and closes it again. Expected cash is unchanged (a till withdrawal becomes a till payment), so the re-closing keeps the same counted cash and difference; test that.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-12: Pagar ou dispensar despesa fixa
- **Dado** a Luz de novembro pendente, com valor previsto R$ 200,00
  **Quando** o proprietário a marca como paga, informando valor R$ 187,43, data 10/11/2026 e meio de pagamento PIX
  **Então** o status vira **pago**, e o valor entra nas despesas fixas do mês **da data de pagamento** (RN-09).
- **Dado** que a conta de Luz de outubro é paga em 10/11
  **Quando** o resumo é consultado
  **Então** ela conta em **novembro** (regime de caixa), e o mês de referência outubro fica registrado.
- **Dado** um lançamento que não se aplica no mês (ex.: TFE fora do mês de cobrança)
  **Quando** o proprietário o marca como **dispensado**
  **Então** ele sai dos alertas e não entra em nenhum total.
- **Dado** uma despesa fixa paga em dinheiro do caixa
  **Quando** o caixa daquele dia é fechado
  **Então** ela reduz o dinheiro esperado (RN-07).
- A data de pagamento não pode cair em dia fechado.

#### FR-13: Controlar parcelas de empréstimo
- **Dado** um empréstimo com 10 parcelas restantes
  **Quando** o lançamento do mês é **pago**
  **Então** o número de parcelas restantes cai para 9, e o lançamento mostra "parcela n de N".

**Business rules** _(verbatim from spec §5)_

**RN-09: Despesas fixas do mês.** Σ valor pago das despesas do tipo fixa com status **pago** e **data de pagamento** no mês (**regime de caixa**). Despesas pendentes e dispensadas não entram.

**RN-07: Fechamento de caixa.**
```
Dinheiro esperado = Troco inicial
                  + Σ vendas em Dinheiro do dia (estornos em dinheiro já negativos)
                  − Σ despesas (gerais e fixas) pagas em Dinheiro com "pago do caixa = sim" na data
                  − Σ sangrias do dia
Diferença = Dinheiro contado − Dinheiro esperado   (>0 sobra, <0 falta)
```

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

---

## 5. Month closing (fechamento do mês)

### #14 — Close and reopen the month

**Milestone:** M5 · **Requirements:** FR-16, FR-17; RN-14
**Depends on:** #10, #13 · **Labels:** `caixa`

**Goal:** The owner closes the month when every day with activity is closed, locking it for edits.

**Scope**

- `POST /api/months/:ym/close`: lists pending days and blocks; warns about pending fixed expenses of the month but allows closing.
- `POST /api/months/:ym/reopen` with a reason (days stay closed).
- Audit both actions. Page "Fechamento" › Mês.

**Out of scope**

- Final monthly spreadsheet and backup on close: hook point `onMonthClosed`, wired in #28 (spreadsheet) and #22 (backup).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-16: Fechar o mês
- **Dado** que todos os dias **com movimento** do mês estão fechados
  **Quando** o proprietário fecha o mês e confirma
  **Então**:
  - o mês fica **fechado**, e nenhum dia, venda ou despesa do mês pode ser alterado;
  - a planilha mensal é gerada na versão final;
  - um backup do banco é feito.
- **Dado** algum dia com movimento ainda aberto
  **Quando** o proprietário tenta fechar o mês
  **Então** o sistema lista os dias pendentes e bloqueia.
- **Dado** despesas fixas ainda **pendentes** cujo mês de referência é o mês que está sendo fechado
  **Quando** o proprietário fecha o mês
  **Então** o sistema avisa, mas permite fechar. As despesas continuam pendentes e entrarão no mês em que forem pagas.

#### FR-17: Reabrir o mês
- **Dado** um mês fechado
  **Quando** o proprietário escolhe "Reabrir mês", confirma e informa um motivo
  **Então** o mês volta a aberto (os dias continuam fechados até serem reabertos um a um), e a ação vai para a auditoria.

**Business rules** _(verbatim from spec §5)_

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

---

## 6. Reports (relatórios)

### #15 — Day report

**Milestone:** M2 · **Requirements:** FR-19; RN-05, RN-07
**Depends on:** #9 · **Labels:** `relatorios`

**Goal:** One screen with everything about a day: tab × payment matrix, expenses, withdrawals and the cash closing.

**Scope**

- Report query module in the server (reused later by the xlsx export in #21).
- Page "Relatórios" › Dia with a date picker.
- Tabs listed in the same order as the owner's daily Excel, so the 2-week comparison (#27, CS-3) is a line-by-line check.

**Out of scope**

- Comparing with the exported spreadsheet: checked in #21.

**Technical notes**

- NFR-04: < 2 s with 5 years of data; add indexes on dates if needed (seed a large test DB).
- This is the comparison tool of the parallel period, so it is part of milestone M2 (before the pilot).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-19: Relatório do Dia
Mostra:
- a matriz **aba × forma de pagamento** com bruto, taxa e líquido;
- os totais por aba, por forma e do dia;
- as saídas do dia e as sangrias;
- os dados do fechamento de caixa (se fechado).
- **Dado** um dia fechado
  **Quando** o relatório é aberto
  **Então** todos os valores coincidem com a planilha diária exportada desse dia.

**Business rules** _(verbatim from spec §5)_

**RN-05: Totais do dia.**
- Total da aba, por forma = Σ (vendas + estornos) dessa aba e forma no dia, separadamente para bruto, taxa e líquido.
- Total da aba = Σ formas.
- Total do dia = Σ abas.

**RN-07: Fechamento de caixa.**
```
Dinheiro esperado = Troco inicial
                  + Σ vendas em Dinheiro do dia (estornos em dinheiro já negativos)
                  − Σ despesas (gerais e fixas) pagas em Dinheiro com "pago do caixa = sim" na data
                  − Σ sangrias do dia
Diferença = Dinheiro contado − Dinheiro esperado   (>0 sobra, <0 falta)
```

### #16 — Month reports: income and general expenses

**Milestone:** M5 · **Requirements:** FR-20, FR-21; RN-06, RN-08
**Depends on:** #6, #7 · **Labels:** `relatorios`, `core`

**Goal:** Monthly income by day × tab and general expenses by category, with totals that add up.

**Scope**

- Core/report: days × tabs grid, totals per tab and per payment method, monthly income, fees, net (RN-06).
- General expenses per category with the "Fornecedores de materiais" group subtotal and drill-down (RN-08).
- Pages "Relatórios" › Mês – Entradas / Mês – Despesas gerais.

**Technical notes**

- Test the FR-20 invariant: column sums = tab totals, sum of tabs = monthly income.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-20: Relatório Mês – Entradas
Mostra:
- uma grade **dias × abas** com o total bruto de cada aba em cada dia;
- os totais por aba no mês;
- os totais do mês **por forma de pagamento** (bruto, taxa, líquido);
- a **Entrada mensal** (bruta), o total de taxas e o líquido.
- **Dado** um mês com vendas em 20 dias
  **Quando** o relatório é aberto
  **Então** a soma da coluna de cada aba é igual ao total dessa aba no mês, e a soma das abas é igual à Entrada mensal.

#### FR-21: Relatório Mês – Despesas gerais
Mostra o total de cada categoria no mês (por data de pagamento), com os fornecedores agrupados em "Fornecedores de materiais", o subtotal do grupo e o **total geral**. Permite ver os lançamentos de cada categoria.

**Business rules** _(verbatim from spec §5)_

**RN-06: Totais do mês (entradas).**
- Entrada mensal = Σ valor_bruto de vendas e estornos com data no mês.
- Taxas do mês = Σ taxa_valor.
- Líquido do mês = Entrada mensal − Taxas do mês.

**RN-08: Despesas gerais do mês.** Σ valor das despesas do tipo geral cuja **data de pagamento** cai no mês. Cada despesa pertence a **exatamente uma categoria**, e as categorias são independentes (ex.: uma compra na Kalunga vai para "Kalunga" **ou** para "Acessórios", nunca para as duas).

### #17 — Month reports: fixed expenses and monthly summary

**Milestone:** M5 · **Requirements:** FR-22, FR-23; RN-09, RN-10
**Depends on:** #13, #16 · **Labels:** `relatorios`, `core`

**Goal:** Fixed expenses for the month and the monthly summary with the balance (saldo).

**Scope**

- Fixed expenses grouped (Gerais, Taxas governo): due date, expected, paid, payment date, status; total paid (cash basis) and pending (informative).
- Summary (RN-10): income, fees, general expenses, fixed expenses, total expenses, balance.

**Technical notes**

- Test FR-23: every summary line equals the matching total in FR-20 to FR-22.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-22: Relatório Mês – Despesas fixas
Mostra cada item (agrupado em Gerais e Taxas governo) com:
- vencimento, valor previsto, valor pago, data de pagamento e status;
- o **total pago no mês** (por data de pagamento);
- o total ainda pendente (informativo, fora do saldo).

#### FR-23: Resumo mensal
Mostra:
- **Entrada mensal** (bruta);
- **(−) Taxas de maquininha**;
- **(−) Total despesas gerais**;
- **(−) Total despesas fixas**;
- **Total geral de despesas**;
- **Saldo mensal** (RN-10).
- **Dado** os relatórios FR-20 a FR-22 de um mês
  **Quando** o resumo é aberto
  **Então** cada linha é igual ao total correspondente nesses relatórios.

**Business rules** _(verbatim from spec §5)_

**RN-09: Despesas fixas do mês.** Σ valor pago das despesas do tipo fixa com status **pago** e **data de pagamento** no mês (**regime de caixa**). Despesas pendentes e dispensadas não entram.

**RN-10: Totais e saldo mensal.**
```
Total geral de despesas = Despesas gerais do mês + Despesas fixas do mês
Saldo mensal = Entrada mensal (bruta) − Taxas do mês − Total geral de despesas
```
As sangrias **não** entram no saldo, porque são movimentação interna.

---

## 7. Dashboards

### #18 — Dashboard: this month vs the previous one

**Milestone:** M6 · **Requirements:** FR-24; RN-11
**Depends on:** #17 · **Labels:** `dashboards`, `core`

**Goal:** Compare the month to date with the same days of the previous month.

**Scope**

- Core: variation % (RN-11) with "—" when the previous value is 0.
- Page "Dashboards" with the four indicators and the full previous month as reference.

**Technical notes**

- Use Recharts (same as the landing page) and the chart tokens `--chart-1..6`.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-24: Dashboard "Como está este mês comparado ao anterior?"
Mostra, para o mês atual **até hoje** e para o **mesmo período do mês anterior** (dia 1 até o mesmo dia do mês), os valores abaixo e a variação % de cada um (RN-11):
- Entrada mensal;
- Taxas;
- Total de despesas;
- Saldo.

O total do mês anterior completo aparece como referência.
- **Dado** o dia 18/11
  **Quando** o dashboard é aberto
  **Então** ele compara 01–18/11 com 01–18/10.
- **Dado** que o mês anterior não tem dados (primeiro mês de uso)
  **Quando** o dashboard é aberto
  **Então** a variação aparece como "—" com a nota "sem dados do mês anterior".

**Business rules** _(verbatim from spec §5)_

**RN-11: Variação percentual (dashboards).**
`variação = (atual − anterior) ÷ |anterior| × 100`, com 1 casa decimal. Se `anterior = 0`, mostrar "—".

### #19 — Dashboards: tab ranking and income × expenses

**Milestone:** M6 · **Requirements:** FR-25, FR-26; RN-11
**Depends on:** #16, #17 · **Labels:** `dashboards`

**Goal:** See which tabs sell most and whether income beats expenses over 7 or 30 days.

**Scope**

- Ranking by gross income with % of total and variation.
- Daily bars of income × expenses (general + paid fixed) for 7/30 days, with zero days.

**Technical notes**

- Tab colors: `categoryColor(order)` so a tab has the same color everywhere.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-25: Dashboard "Quais abas vendem mais?"
Mostra o ranking das abas pela entrada bruta no mês selecionado, com valor, % do total e variação em relação ao mesmo período do mês anterior.
- **Dado** um mês com vendas
  **Quando** o dashboard é aberto
  **Então** as abas aparecem em ordem decrescente de entrada bruta. "Mais lucrativas" significa **maior faturamento**, não margem (ver Q-11).

#### FR-26: Dashboard "Estou ganhando mais do que gasto?"
Gráfico diário de **entradas brutas × despesas** (gerais + fixas pagas) para os **últimos 7 ou 30 dias** (seletor), com os totais do período e a diferença.
- **Dado** que o proprietário escolhe "30 dias"
  **Quando** o gráfico é exibido
  **Então** os dias sem movimento aparecem como zero, e os totais do período batem com a soma das barras.

**Business rules** _(verbatim from spec §5)_

**RN-11: Variação percentual (dashboards).**
`variação = (atual − anterior) ÷ |anterior| × 100`, com 1 casa decimal. Se `anterior = 0`, mostrar "—".

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-11 | Ao pedir "abas mais lucrativas", o senhor aceita ver **as que mais faturam**? Lucro por aba exigiria ligar compras às abas, o que contradiz a regra de categorias independentes. | Dashboard FR-25. | Ranking por faturamento. |

---

## 8. OneDrive exports, backup and settings

### #20 — Settings

**Milestone:** M4 · **Requirements:** FR-33
**Depends on:** #1 · **Labels:** `configuracoes`

**Goal:** The owner configures the OneDrive folder (with a write test) and the alert thresholds.

**Scope**

- Uses the existing `settings` table (key/value). Defaults: cash-difference limit R$ 0,00; due-soon window 3 days.
- "Testar" creates and deletes a test file and shows clear pt-BR errors.
- Page "Configurações". Audit every change.
- Migrate the pilot's OneDrive folder setting (config file from #25) into the `settings` table on first start.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-33: Configurações
- pasta do OneDrive (com botão "Testar": cria e apaga um arquivo de teste);
- limite do alerta de diferença de caixa (padrão R$ 0,00);
- antecedência do alerta de contas a vencer (padrão 3 dias).

- **Dado** uma pasta inexistente ou sem permissão de escrita
  **Quando** o proprietário clica em "Testar"
  **Então** o sistema mostra o erro de forma clara, em português.

**Open questions that affect this item** _(verbatim from spec §10)_

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-07 | O PC da loja tem o **aplicativo OneDrive** instalado e conectado à conta certa? Qual pasta usar? Há espaço livre na conta? | Sem isso não há backup fora do PC. | Verificação obrigatória na implantação. |

### #21 — Daily spreadsheet export and the retry queue

**Milestone:** M4 · **Requirements:** FR-28, FR-30
**Depends on:** #15, #20 · **Labels:** `onedrive`, `export`

**Goal:** Closing a day produces the daily .xlsx in the OneDrive folder, with retries when Excel has it open. This is what lets the owner stop his daily Excel (§9.5 step 5).

**Scope**

- `export_queue` table (spec §6.1 ItemFilaExportação), generic enough for monthly spreadsheets (#28) and DB backups (#22); worker that retries every 5 min and at startup; "Tentar agora".
- ExcelJS builder for the **daily** layout (§7.3), numbers stored as numbers, R$ and dd/mm/aaaa formats.
- Atomic write: temp file in the same folder, then rename (§7.4).
- Wire the `onDayClosed` hook point from #9. "Backup pendente" shown on Início until #23.

**Out of scope**

- Monthly spreadsheet (#28).
- Database backups (#25, #22).

**Technical notes**

- Reuse the day report query from #15 so the file always matches the screen (FR-19).
- Must ship before the parallel period ends (milestone M4).

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-28: Exportar a planilha diária
Gera `Diária AAAA-MM-DD.xlsx` (layout em §7.3) na pasta do OneDrive.
- **Dado** que um dia é fechado
  **Quando** a exportação roda
  **Então** o arquivo é criado, ou **sobrescrito** se já existir.
- **Dado** um dia reaberto e fechado de novo
  **Quando** a exportação roda
  **Então** o arquivo anterior é substituído pela versão corrigida.
- Dias sem movimento **não** geram arquivo.

#### FR-30: Fila de exportação e novas tentativas
- **Dado** que o arquivo está aberto no Excel, ou a pasta não existe
  **Quando** a exportação falha
  **Então**:
  - o pedido fica na fila com o erro;
  - o alerta "Backup pendente" aparece;
  - uma nova tentativa é feita a cada 5 minutos e ao abrir o sistema.
- **Dado** um pedido pendente
  **Quando** uma tentativa dá certo
  **Então** o pedido sai da fila e o alerta some.
- O proprietário pode forçar "Tentar agora".

**Spec §7.2** _(verbatim)_

##### 7.2 Estrutura de pastas e nomes
```
<pasta configurada>/
├── 2026/
│   ├── 11 - Novembro/
│   │   ├── Diária 2026-11-01.xlsx
│   │   ├── Diária 2026-11-03.xlsx
│   │   └── Mensal 2026-11.xlsx
│   └── 12 - Dezembro/ …
└── _backup-sistema/
    ├── color-2026-11-18_1903.db
    └── …
```

**Spec §7.3** _(verbatim)_

##### 7.3 Layout das planilhas
**Diária AAAA-MM-DD.xlsx**
- **Uma aba por categoria de venda** com movimento no dia.
  - Linhas: hora, tipo (venda/estorno), forma, maquininha, parcelas, valor cheio, taxa %, taxa R$, valor real, observação.
  - No fim: subtotal por forma de pagamento (cheio/taxa/real) e total da aba.
- **Aba "Saídas":** despesas do dia (categoria, descrição, meio, do caixa?, valor), total, e sangrias.
- **Aba "Resumo do dia":** matriz aba × forma, total do dia, e fechamento de caixa (troco inicial, esperado, contado, diferença).

**Mensal AAAA-MM.xlsx**
- **Aba "Entradas":** grade dias × abas, totais por forma de pagamento, Entrada mensal, taxas, líquido.
- **Aba "Despesas gerais":** por categoria, com o grupo Fornecedores e o total.
- **Aba "Despesas fixas":** cada item com vencimento, valor pago, data de pagamento e status, e o total pago.
- **Aba "Resumo":** Total geral de despesas, Entrada mensal, Taxas, **Saldo mensal**.

**Formatos:**
- Moeda: R$ #.##0,00.
- Datas: dd/mm/aaaa.
- Os valores são gravados como **números**, não texto, para que somas manuais no Excel funcionem.

**Spec §7.4** _(verbatim)_

##### 7.4 Tratamento de falhas
| Cenário | Comportamento |
|---|---|
| Arquivo aberto ou bloqueado no Excel | A gravação falha. O item fica na fila, aparece o alerta "Backup pendente", e há nova tentativa a cada 5 min. |
| Pasta inexistente, renomeada ou sem permissão | Mesmo comportamento. O alerta orienta a verificar a pasta em Configurações. |
| Sem internet | **Não é falha do sistema**: o arquivo é gravado localmente, e o OneDrive envia quando a conexão voltar. |
| Aplicativo OneDrive não instalado, deslogado ou com cota cheia | O sistema **não consegue detectar** (o arquivo é gravado localmente). Mitigação: verificar a configuração na implantação, e o proprietário deve conferir periodicamente o ícone do OneDrive (ver Q-07). |
| Queda de energia durante a gravação | Gravação **atômica**: escreve em arquivo temporário e depois renomeia, para nunca deixar uma planilha corrompida. O banco usa transações. |
| Disco do PC danificado | Restaurar o último backup do banco a partir do OneDrive em um PC novo (FR-32). Perda máxima: os lançamentos desde o último backup (no pior caso, os do dia corrente ainda não fechado). |

### #22 — Database backup and restore

**Milestone:** M5 · **Requirements:** FR-31, FR-32; RN-13
**Depends on:** #21, #25 · **Labels:** `onedrive`, `backup`, `core`

**Goal:** Completes the pilot backup (#25): retention, failures in the queue and alert, and restore from the UI.

**Scope**

- Build on #25's `VACUUM INTO` backup; failures go to the export queue (#21).
- Core: retention (RN-13) as a pure function over the list of backup files; apply it after each backup.
- Restore: safety copy of the current DB, swap, reopen and migrate, audit row; restore from a file on a new PC.
- Backup on month close (`onMonthClosed`, #14).

**Technical notes**

- NFR-07: restore is tested before the full go-live (also listed in #24); during the pilot the documented manual restore from #25 applies.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-31: Backup do banco de dados
- **Dado** um fechamento de dia, um fechamento de mês, ou a primeira abertura do sistema no dia
  **Quando** o backup roda
  **Então** uma cópia consistente do banco é gravada em `<pasta>/_backup-sistema/`, e a política de retenção RN-13 é aplicada.
- Uma falha no backup segue a mesma fila e o mesmo alerta de FR-30.

#### FR-32: Restaurar backup
- **Dado** a lista de backups disponíveis (data e hora)
  **Quando** o proprietário escolhe um, confirma e informa um motivo
  **Então**:
  - o sistema salva antes uma cópia de segurança do banco atual;
  - substitui o banco pelo backup escolhido;
  - reinicia;
  - registra a restauração na auditoria.
- **Dado** um PC novo com o sistema recém-instalado
  **Quando** o proprietário aponta um arquivo de backup
  **Então** o sistema volta exatamente ao estado daquele backup.

**Business rules** _(verbatim from spec §5)_

**RN-13: Retenção de backups do banco.**
- Guardar os backups dos **últimos 30 dias**, no máximo 1 por dia (o mais recente do dia).
- Guardar também o **último backup de cada mês**, sem limite de tempo.
- Apagar os demais.

### #23 — Home screen alerts

**Milestone:** M6 · **Requirements:** FR-27
**Depends on:** #9, #13, #21, #22 · **Labels:** `inicio`

**Goal:** Início shows what needs attention today, each alert with a link to fix it.

**Scope**

- Alerts: due soon, overdue, day not closed, cash difference, backup pending; "Tudo em dia" when none.
- Shortcuts: register sale, register expense, close the day.

**Technical notes**

- Replace the walking-skeleton health card with the alerts (keep the health info in Configurações).
- Absorb the pilot's open-day warning (#9) and backup-pending notice (#21) into this list.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-27: Alertas
A tela inicial mostra os alertas abaixo, cada um com link para resolver:

| Alerta | Condição |
|---|---|
| Conta a vencer | Despesa fixa pendente com vencimento entre hoje e hoje + 3 dias. |
| Conta vencida | Despesa fixa pendente com vencimento antes de hoje. |
| Dia não fechado | Dia anterior a hoje com movimento e status aberto. |
| Diferença de caixa | No último fechamento, \|diferença\| > limite configurado (**padrão R$ 0,00**, ou seja, qualquer diferença). |
| Backup pendente | Há exportação ou backup na fila com falha (ver §7). |

- **Dado** que não há nenhuma condição ativa
  **Quando** a tela inicial abre
  **Então** aparece "Tudo em dia".
- A tela inicial também oferece **atalhos** para registrar venda, registrar despesa e fechar o dia.

---

## 9. Installation and go-live

### #24 — Windows installer, auto-start and deployment checklist

**Milestone:** M6 · **Requirements:** FR-34
**Depends on:** #22, #26 · **Labels:** `instalacao`

**Goal:** Replaces the pilot install (#26) with a proper installer; it starts with Windows and works offline.

**Scope**

- Inno Setup installer: portable Node, built app, data in `%LOCALAPPDATA%\ColorBMS\data` (ADR 0001).
- Task Scheduler task "At log on" (hidden, restart on failure) and a desktop shortcut to `http://127.0.0.1:3210`.
- Upgrade path from the pilot install: keep the data folder, remove the pilot scheduled task and shortcuts.
- Update path that keeps the data folder; backup before migrations.
- Release workflow on `windows-latest` that builds the installer.
- Deployment checklist (spec §9.5): rates, fixed expenses, OneDrive folder, backup and restore test, Windows time sync.

**Technical notes**

- Updates stay physical (USB stick at the shop), as in the pilot.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-34: Instalação e inicialização
- **Dado** o PC ligado
  **Quando** o Windows inicia
  **Então** o sistema inicia em segundo plano, e o atalho na área de trabalho abre a interface no navegador.
- **Dado** que o PC está sem internet
  **Quando** o proprietário usa o sistema
  **Então** todas as funções operam normalmente, exceto a sincronização do OneDrive, que é feita pelo próprio aplicativo do OneDrive quando a conexão voltar.

**Spec §9.5** _(verbatim)_

##### 9.5 Implantação
1. Antes da implantação:
   - cadastrar as taxas atuais (Q-01);
   - cadastrar os modelos de despesa fixa com dias de vencimento (Q-05, Q-06);
   - configurar a pasta do OneDrive;
   - testar o backup e a restauração.
2. **Entrar em uso no dia 1º de um mês.**
3. Informar à mão o troco inicial do primeiro dia.
4. **Período paralelo de 2 semanas:** o proprietário mantém a planilha atual, e os totais diários são comparados todos os dias (CS-3).
5. Depois do período paralelo, o Excel manual é abandonado, e as planilhas geradas pelo sistema passam a ser o backup.

**Non-functional requirements** _(verbatim from spec §8)_

| ID | Categoria | Requisito |
|---|---|---|
| NFR-02 | Plataforma | Windows 11. Inicia com o Windows e tem atalho na área de trabalho. Navegador: Edge ou Chrome atuais. |
| NFR-07 | Backup | Conforme FR-31 e RN-13. Restauração testada antes da implantação. |
| NFR-13 | Instalação | Instalação e atualização simples, feitas pelo desenvolvedor, sem exigir conhecimento técnico do proprietário. |

---

## 10. Pilot and Phase 2 additions

### #25 — Pilot database backup

**Milestone:** M3 · **Requirements:** slice of FR-31
**Depends on:** #9 · **Labels:** `pilot`, `backup`

**Goal:** From the first pilot day, a consistent copy of the database is written automatically to the OneDrive folder, so no confirmed day can be lost (NFR-06, §7.4).

**Scope**

- Backup with `VACUUM INTO` to a temp file, then rename into `<pasta>/_backup-sistema/color-AAAA-MM-DD_HHMM.db` (§7.2, ADR 0001).
- Triggers: day close (`onDayClosed`) and server startup (first start of the day) → OneDrive folder.
- **Before applying migrations** (each pilot update): a backup in the local data folder (`data\backups\`), which is always available, so an update never depends on OneDrive.
- OneDrive folder read from a small config file in the data folder (`config.json`) or an environment variable; moved into Settings by #20.
- No retention (backups are small; RN-13 comes with #22), no restore UI.
- Failures are logged and shown as a simple notice on Início; the backup is retried at the next trigger.
- Documented manual restore procedure (pt-BR, step by step): stop the app, copy the chosen `.db` over `color.db`, start.

**Out of scope**

- Retention RN-13, queue integration, restore UI (#22).

**Technical notes**

- `VACUUM INTO` gives a consistent snapshot even while the app is running; never copy the live `color.db` file.

**Acceptance criteria** _(defined for this item; not in the spec)_

- Closing a day writes a new backup file in `_backup-sistema/` that opens as a valid SQLite database with the day's data.
- Starting the server with pending migrations writes a local backup **before** migrating; if that backup fails, the server does not migrate and logs why.
- If the OneDrive folder does not exist, the day still closes (the closing is never blocked) and the failure is visible on Início.
- The manual restore procedure is tested once on the shop PC before go-live (NFR-07).

**Spec reference** _(verbatim; only the parts listed under Scope belong to this item)_

#### FR-31: Backup do banco de dados
- **Dado** um fechamento de dia, um fechamento de mês, ou a primeira abertura do sistema no dia
  **Quando** o backup roda
  **Então** uma cópia consistente do banco é gravada em `<pasta>/_backup-sistema/`, e a política de retenção RN-13 é aplicada.
- Uma falha no backup segue a mesma fila e o mesmo alerta de FR-30.

### #26 — Pilot install on the shop PC

**Milestone:** M3 · **Requirements:** slice of FR-34
**Depends on:** #25 · **Labels:** `pilot`, `instalacao`

**Goal:** A simple, scripted install and update of the app on the shop's Windows 11 PC, done in person from a USB stick; the app starts with Windows and the owner opens it from a desktop shortcut.

**Scope**

- `npm run package:pilot` builds `color-bms-<version>.zip`: built web + server, production `node_modules` (better-sqlite3 ships its `win32-x64` binary inside the npm package, so the zip can be built on any OS), portable `node.exe` (pinned Node 26), and pt-BR scripts. CI uploads it as an artifact.
- `instalar.cmd`: copies the app to `%LOCALAPPDATA%\ColorBMS\app`, creates `%LOCALAPPDATA%\ColorBMS\data`, registers a Task Scheduler task "At log on" (hidden, restart on failure), and a desktop shortcut that opens Edge in app mode on `http://127.0.0.1:3210`.
- `atualizar.cmd` (run from the USB stick): stop the app → backup (via #25) → replace `app\` only → start → open the health page showing the new version.
- `iniciar.cmd` / `parar.cmd` for support; server logs written to `data\logs\` (rotated), since the hidden process has no console.
- Separate **trial** data folder for training days, and a documented go-live reset: stop, archive the trial folder, start with a fresh database (seeds only).
- Startup checks shown on the health page: PC clock vs São Paulo date, port 3210 free, data and OneDrive folders writable.

**Out of scope**

- Inno Setup installer and release workflow (#24).

**Technical notes**

- This is a temporary simplification of ADR 0001's packaging; #24 replaces the scripts with the Inno Setup installer and keeps the same folders.

**Acceptance criteria** _(defined for this item; not in the spec)_

- On a clean Windows 11 machine (or VM), running `instalar.cmd` from the USB stick and rebooting starts the app at logon without any window, and the desktop shortcut opens the Início page.
- The app works with the network cable unplugged (NFR-03) and is not reachable from another PC on the network (NFR-08).
- `atualizar.cmd` upgrades to a newer zip, keeps all data, writes a backup before migrating, and the health page shows the new version.
- The go-live reset leaves an empty database whose first closing has an empty opening cash (FR-08).
- A server crash is restarted automatically and the cause is in the log file.

**Spec reference** _(verbatim; only the parts listed under Scope belong to this item)_

#### FR-34: Instalação e inicialização
- **Dado** o PC ligado
  **Quando** o Windows inicia
  **Então** o sistema inicia em segundo plano, e o atalho na área de trabalho abre a interface no navegador.
- **Dado** que o PC está sem internet
  **Quando** o proprietário usa o sistema
  **Então** todas as funções operam normalmente, exceto a sincronização do OneDrive, que é feita pelo próprio aplicativo do OneDrive quando a conexão voltar.

**Non-functional requirements** _(verbatim from spec §8)_

| ID | Categoria | Requisito |
|---|---|---|
| NFR-02 | Plataforma | Windows 11. Inicia com o Windows e tem atalho na área de trabalho. Navegador: Edge ou Chrome atuais. |
| NFR-03 | Offline | 100% funcional **sem internet**. |
| NFR-08 | Segurança | No MVP, o servidor aceita conexões **apenas do próprio PC** (localhost). Sem login (ver §2). |

### #27 — Pilot go-live and the parallel period

**Milestone:** M3 · **Requirements:** spec §9.5
**Depends on:** #26, #15 · **Labels:** `pilot`, `implantacao`

**Goal:** The owner uses the system for real from the 1st of a month while keeping his Excel for 2 weeks, and the daily totals are compared every day (CS-3).

**Scope**

- Go-live checklist (`docs/pilot/go-live-checklist.md`): real fee table entered (Q-01), tabs/categories reviewed with the owner, PC clock and time zone, OneDrive folder, backup and manual restore tested, go-live reset done.
- One-page owner guide in pt-BR (`docs/pilot/guia-rapido.md`): register a sale, refund, expense, sangria, close and reopen the day, what to do if something goes wrong, the interim "CONTA:" rule for bills paid from the till.
- Training session with trial data (1 h) and the stopwatch measurements CS-2 (≤ 10 s per sale, average of 10) and CS-4 (≤ 3 min to close).
- Daily comparison sheet for the 2 weeks (`docs/pilot/conferencia.md` or a printed table): date, Excel total, system total per tab and payment method, difference, reason, fix.
- Weekly visit to collect feedback and apply updates (USB stick, #26).

**Technical notes**

- Open questions to take to the owner: `docs/pilot/owner-questions.md`.

**Acceptance criteria** _(defined for this item; not in the spec)_

- CS-1 to CS-5 have a recorded measurement or status at the end of the parallel period.
- Every difference found in the comparison has a reason (system bug, typing error, Excel error) and, for bugs, a backlog item.
- The owner stops the daily Excel only when #21 (daily .xlsx export) is live and CS-3 held for 2 weeks; otherwise the parallel period is extended.

**Spec §9.5** _(verbatim)_

##### 9.5 Implantação
1. Antes da implantação:
   - cadastrar as taxas atuais (Q-01);
   - cadastrar os modelos de despesa fixa com dias de vencimento (Q-05, Q-06);
   - configurar a pasta do OneDrive;
   - testar o backup e a restauração.
2. **Entrar em uso no dia 1º de um mês.**
3. Informar à mão o troco inicial do primeiro dia.
4. **Período paralelo de 2 semanas:** o proprietário mantém a planilha atual, e os totais diários são comparados todos os dias (CS-3).
5. Depois do período paralelo, o Excel manual é abandonado, e as planilhas geradas pelo sistema passam a ser o backup.

### #28 — Monthly spreadsheet export

**Milestone:** M5 · **Requirements:** FR-29
**Depends on:** #17, #21 · **Labels:** `onedrive`, `export`

**Goal:** The monthly .xlsx is updated on every day close and written in its final version on month close.

**Scope**

- ExcelJS builder for the **monthly** layout (§7.3), reusing the month report queries (#16, #17).
- Uses the export queue from #21; wire `onDayClosed` (update) and `onMonthClosed` (final version, #14).

**Technical notes**

- Split from #21 so the daily export can ship before the month reports exist.

**Acceptance criteria** _(verbatim from spec §4)_

#### FR-29: Exportar a planilha mensal
Gera ou atualiza `Mensal AAAA-MM.xlsx` cada vez que um dia do mês é fechado, e na versão final quando o mês é fechado.

**Spec §7.3** _(verbatim)_

##### 7.3 Layout das planilhas
**Diária AAAA-MM-DD.xlsx**
- **Uma aba por categoria de venda** com movimento no dia.
  - Linhas: hora, tipo (venda/estorno), forma, maquininha, parcelas, valor cheio, taxa %, taxa R$, valor real, observação.
  - No fim: subtotal por forma de pagamento (cheio/taxa/real) e total da aba.
- **Aba "Saídas":** despesas do dia (categoria, descrição, meio, do caixa?, valor), total, e sangrias.
- **Aba "Resumo do dia":** matriz aba × forma, total do dia, e fechamento de caixa (troco inicial, esperado, contado, diferença).

**Mensal AAAA-MM.xlsx**
- **Aba "Entradas":** grade dias × abas, totais por forma de pagamento, Entrada mensal, taxas, líquido.
- **Aba "Despesas gerais":** por categoria, com o grupo Fornecedores e o total.
- **Aba "Despesas fixas":** cada item com vencimento, valor pago, data de pagamento e status, e o total pago.
- **Aba "Resumo":** Total geral de despesas, Entrada mensal, Taxas, **Saldo mensal**.

**Formatos:**
- Moeda: R$ #.##0,00.
- Datas: dd/mm/aaaa.
- Os valores são gravados como **números**, não texto, para que somas manuais no Excel funcionem.
