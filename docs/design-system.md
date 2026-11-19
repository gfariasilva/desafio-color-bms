# Design system

The UI reuses the brand of the Color landing page (`gfariasilva/desafio-color-landing-page`): the same tokens, logo, font and shadcn/ui setup. This app is an **operational back-office**, though, not a marketing site, so the style is adapted for speed and readability: dense, calm and keyboard-first.

Source files:

| What | File |
|---|---|
| CSS variables (tokens, light + dark) and rainbow utilities | `apps/web/src/index.css` |
| Tailwind theme (colors, radius, font) | `apps/web/tailwind.config.ts` |
| shadcn/ui config | `apps/web/components.json` |
| `cn()` class helper | `apps/web/src/lib/utils.ts` |
| Components | `apps/web/src/components/ui/` |
| Category / chart colors | `apps/web/src/lib/category-colors.ts` |
| pt-BR formatters | `packages/core/src/format/` |

## Tokens

All colors are HSL CSS variables, used through Tailwind classes (`bg-primary`, `text-muted-foreground`…). **Never hard-code hex/rgb values in components.** The `.dark` class on `<html>` switches every token to its dark value.

| Token | Tailwind | Use |
|---|---|---|
| `--background` / `--foreground` | `bg-background`, `text-foreground` | Page background and body text |
| `--card` | `bg-card` | Cards, panels, tables |
| `--primary` (brand blue 217 91% 50%) | `bg-primary`, `text-primary` | Main action per screen, active nav item, links |
| `--secondary`, `--accent`, `--muted` | `bg-muted`, `text-muted-foreground` | Secondary buttons, hover, labels and help text |
| `--destructive` | `bg-destructive`, `text-destructive` | Delete, errors, cash **shortage** |
| `--border`, `--input`, `--ring` | `border`, `ring-ring` | Borders, inputs, focus ring |
| `--rainbow-{red,orange,yellow,green,blue,purple}` | `bg-rainbow-green`… | Brand accent and category colors only |
| `--chart-1…6` (= rainbow) | `bg-chart-1`… | Chart series and categories |
| `--sidebar-*` | `bg-sidebar`… | Sidebar only |
| `--radius` = 0.75rem | `rounded-lg` (cards), `rounded-md` (buttons, inputs) | Corner radius |

**Typography:** Inter (variable), bundled with `@fontsource-variable/inter` so it works offline. Body text is `text-sm` (14px). Page titles use `text-xl font-semibold`. Section titles use `text-base font-semibold`.

## The rainbow: accent only

The rainbow is the brand's signature, so it gets used sparingly:

- ✅ The 4px `rainbow-gradient` stripe at the top of the app (already in `AppShell`).
- ✅ The logo in the sidebar.
- ✅ Single rainbow colors as **category and chart colors** (see below).
- ✅ `bg-rainbow-green` for positive status ("Conectado", "Pago", cash surplus).
- ❌ No gradient backgrounds on buttons, cards or headers. No `rainbow-text` in the app.

### Category and chart colors

Sale tabs ("abas"), expense categories and chart series use `categoryColor(index)` from `src/lib/category-colors.ts`. The index is the category's **display order**, so a category keeps the same color in every table and chart. The palette is ordered for contrast between neighbours: blue, orange, green, purple, red, yellow, and it repeats after six. Use the color as a small dot or bar beside the text, never as the text color itself, which would hurt contrast.

## Back-office style rules

- **Dense:** buttons and inputs are `h-9` (small: `h-8`). Table rows are compact (`h-9`, `px-3 py-2`). Cards use `p-4`, not `p-6`.
- **Numbers:** money is right-aligned with `tabular-nums` (applied automatically on `td`/`th`). Always format with `formatCents()` and never build "R$" strings by hand.
- **No decorative motion:** no float, pulse, fade-in or slide-in. Short `transition-colors` on hover is fine. `prefers-reduced-motion` is respected globally.
- **Status colors:** green (`rainbow-green`) for ok, paid and surplus. `destructive` for errors, overdue and shortage. `rainbow-yellow`/`orange` for warnings such as "a vencer" or "backup pendente". Always add a text label too; color alone is not enough.
- **Empty states:** a short pt-BR sentence saying what to do next ("Nenhuma venda hoje. Registre a primeira com Enter.").

## Keyboard-first (NFR-05)

- **Alt+1 … Alt+9** open the nine main areas (`src/config/navigation.ts`). The shortcut is shown in the sidebar.
- Every interactive element has a visible focus ring (`focus-visible:ring-2 ring-ring`). Never remove it.
- Data-entry forms: logical tab order, **Enter submits**, Esc cancels or closes, and focus returns to the first field after saving so the next entry can start immediately (FR-01, CS-2).
- Don't use shortcuts the browser or Windows already own, such as Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+1–9 and F5.

## pt-BR formatting

Import these from `@color-bms/core`:

| Helper | Input | Output |
|---|---|---|
| `formatCents(123456)` | integer cents | `R$ 1.234,56` (non-breaking space after `R$`) |
| `formatCents(-8000)` | negative cents | `-R$ 80,00` |
| `formatCivilDate("2026-11-18")` | civil date | `18/11/2026` |
| `formatInstant("2026-11-18T22:03:00Z")` | UTC instant | `18/11/2026 19:03` (São Paulo time) |
| `todayCivilDate()` | — | today in São Paulo, `"YYYY-MM-DD"` |

## Components (shadcn/ui)

- **Add a component only when a screen uses it.** Copy it from the landing page (`src/components/ui/`) if it is there; otherwise use the Tailwind 3-compatible CLI: `npx shadcn@2 add <component>` from `apps/web`. The latest shadcn CLI targets Tailwind 4.
- After adding, apply the density rules: default size `h-9`, card padding `p-4`.
- Currently in use: `button` (sizes tightened to `h-9`), `card`, `badge` (plus a `success` variant), `separator`, `input` (`h-9`), `label` (plain `<label>`, no Radix), `table` (rows `h-9`, cells `px-3 py-2`).
- **`ChoiceGroup`** (`components/ui/choice-group.tsx`, our own): a row of numbered chips for choosing from a short list in a data-entry form (sale tab, payment method, card machine). It is an ARIA radio group with one tab stop; on a focused option, **digits 1–9** pick by number (shown on the chip), **letters** jump by name (case and accents ignored), arrows move, Enter submits. Use it where speed matters (CS-2); use `NativeSelect` for filters and long lists. Tabs show their category color dot.
- **Fast entry forms** (`pages/SalesPage.tsx`, FR-01): focus starts on the first field (Valor); fields that do not apply are disabled, not hidden; a muted preview line shows what will be saved (fee and net); after saving, a `role="status"` line confirms ("Venda de R$ 25,00 registrada."), the form is cleared except for the date, and focus returns to the first field. Errors go in a `role="alert"` line, with a link when the fix lives on another screen ("Abrir tabela de taxas"). A number field that has a default selects its text on focus, so typing replaces it.
- **Day view per tab** (`components/sales/DaySalesView.tsx`, FR-05): one card per tab, whose header is a button (`aria-expanded`, chevron, category dot, "n lançamentos", Bruto · Taxa · Líquido) inside a `<section aria-labelledby>`. Tabs with entries start open, empty ones start collapsed at R$ 0,00. Inside: the entries, then `tfoot` rows "Subtotal <forma>" and "Total da aba". A muted "Total do dia" card closes the view. A closed day shows a "Dia fechado" badge next to the section title.
- **Edit in the entry form** (Vendas, FR-03): "Editar" (pencil icon button) loads the row into the same fast-entry form: a banner "Editando a venda das 10:05 de R$ 25,00 · Esc cancela", the form's `aria-label` becomes "Editar venda", Salvar + Cancelar, the row is highlighted (`bg-muted`). After saving, the form returns to a new entry with the date kept and focus on the first field. Deactivated tabs/methods/machines of the edited record are offered while editing. On a locked day, Editar/Excluir show the lock message in the alert instead.
- **Secondary action panel** (Vendas, FR-04 "Estornar"): an icon button on the row (undo icon, `aria-label` "Estornar venda das 10:05 de R$ 80,00") opens a compact form card (destructive-tinted border) between the entry form and the list, with a one-line summary of what it acts on, focus on its first field (prefilled with the suggested value, selected on focus), Enter submits, Esc cancels; after success, the confirmation goes to the main form's status line and focus returns to Valor. Negative amounts keep their sign: money cells are `whitespace-nowrap` so "-R$ 80,00" never wraps. Refund rows show a `destructive` badge "Estorno".
- **Expense entry** (`pages/ExpensesPage.tsx`, FR-06): the same fast-entry pattern as Vendas (Valor first, Enter saves, Editar/Excluir on the row, Esc cancels). Categoria is a `NativeSelect` with one `<optgroup>` per group (Geral / Fornecedores de materiais), since 15 categories are too many for digit chips and typing the first letters jumps to one. Meio de pagamento is a `ChoiceGroup` (digits 1–5, A-14). The day list is one dense table with the category color dot, then `tfoot` rows "Pago do caixa (dinheiro)" and "Total do dia", and a muted month line below.
- **Checkbox:** a native `<input type="checkbox">` (`h-4 w-4 accent-primary`, focus ring) inside its `<label>`; the label is dimmed with `has-[:disabled]:opacity-50`. Enter on it submits the form like every other field. A checkbox that does not apply is disabled and unchecked, never hidden ("Pago com dinheiro do caixa" only for Dinheiro, checked by default).
- **`NativeSelect`** (`components/ui/native-select.tsx`): a native `<select>` styled like `Input`. Use it for short fixed lists such as filters: it is keyboard-usable out of the box (type to jump, arrows to move) and **Enter submits the form**, which browsers do not do on a `<select>` by themselves.
- **Filter bars:** a `<form>` with labelled fields in one row (`flex flex-wrap items-end gap-3`) and a primary **Filtrar** button; Enter in any field applies the filters. Validate with the same Zod schema as the server and show its pt-BR message in a `role="alert"` paragraph.
- **Second entry form on a page** (Despesas, FR-07 sangrias, `components/cash-withdrawals/CashWithdrawalsSection.tsx`): a `<section aria-labelledby>` below the first form's list, with an `outline` badge that says what it is not ("Não é despesa") and a muted sentence explaining it. Its form has its own `aria-label` ("Nova sangria"), its own `role="status"`/`role="alert"` lines and Editar/Excluir, and reuses the page's date instead of a second date field. Its labels are distinct from the first form's ("Valor da sangria (R$)"), and its table has an `aria-label` ("Sangrias do dia").
- **Calculation card** (Fechamento, FR-08, `components/cash-closing/`): a narrow card (`max-w-xl`) with one `CashLine` per term, like the owner's paper sheet: a muted sign column (+ − =), the label, and a right-aligned value; the total line (`Dinheiro esperado`) and the counted line are `font-semibold`. Inputs sit inside their lines (`w-36`, right-aligned), and the result recomputes as the owner types ("—" until it can). The difference is a `DifferenceBadge`: `success` "Sobra de R$ …", `destructive` "Falta de R$ …", `secondary` "Sem diferença". A closed record shows the same lines read-only (`ClosedDaySummary`) with a "Dia fechado" badge next to the section title.
- **Confirm a surprising value in place** (FR-08 difference): the first Enter does not save; a bordered `role="alert"` box (destructive border for a shortage, green for a surplus) repeats the value in `text-base font-semibold`, focus moves to the optional Observação, the submit button becomes "Fechar mesmo assim" with "Voltar"; Enter confirms, Esc goes back to the value. Changing an amount cancels the confirmation. No modal dialog.
- **Confirm a sensitive action with a reason** (Fechamento, FR-09 "Reabrir dia" and FR-17 "Reabrir mês", spec §2; shared component `components/cash-closing/ReopenPanel.tsx`): an outline button under the record opens a compact card in place (destructive-tinted border, no modal) with "Tem certeza?", what will happen, and a required Motivo field (focused). The destructive submit repeats the action's name; Enter confirms, Esc or "Cancelar" closes the card and returns focus to the button. When the action is not allowed (e.g. closed month), the button is replaced by a muted line saying why.
- **Confirm a sensitive action without a reason** (FR-16 "Fechar mês"): the primary button opens the same in-place card (primary-tinted border) with "Tem certeza?", what will be locked, and the buttons **Confirmar fechamento** (focused, so Enter confirms) and **Cancelar**; Esc closes it and returns focus. Warnings that do not block (e.g. pending fixed expenses) sit above it as a bordered `role="note"` box with an amber warning icon. Things that block (e.g. days still open) are listed as links to where they are fixed, and the button is not shown.
- **Alerts on Início** (FR-27 slice): a card titled "Alertas" (`<section aria-labelledby>`), one dense row per alert with a `rainbow-orange` warning icon and the text, and a "Fechar" link on the right (`aria-label` "Fechar o dia dd/mm/aaaa") to the screen that resolves it (`/fechamento?data=…`).
- **Master-data lists** (`components/catalog/CatalogListManager.tsx`, FR-14 and FR-15: abas, categorias de despesa, formas de pagamento, maquininhas): a "Nova …" form above the list (Enter adds, focus returns to the name field); a dense table with the category color dot, an Ativa/Inativa badge and icon actions with `aria-label`s (Renomear, Mover para cima/baixo, Desativar/Reativar, Excluir). Renaming is inline: Enter saves, Esc cancels. Inactive rows stay visible but muted. Duplicate names are checked on the client with the same core rule as the server. When the server blocks a delete (`category_in_use`), the alert offers **Desativar**. Lists with groups (expense categories) show one titled table per group, and ↑/↓ move within the group. Payment methods add two columns, **Maquininha** (Obrigatória / Opcional / Não se aplica) and **Parcelas** (Sim / Não), with matching selects in the "Nova …" form and in the inline edit.
- **Versioned rate tables** (`pages/CardFeesPage.tsx`, FR-15): one form row above the table (selects → numbers → `Taxa (%)` typed as "3,79" → `Vigente desde` date, default today); Enter saves, focus returns to the first field and machine/method/date are kept for the next row. **Editar** loads a row into the same form (Salvar / Cancelar, Esc cancels). Fields that do not apply are disabled, not hidden (Parcelas locked to 1 for methods without installments). One titled table per machine; percentages right-aligned; a status badge per row: **Em vigor** (`success`), **Futura** (`secondary`), **Substituída** (`outline`, muted row). Overlaps are checked on the client with the same core rule as the server.
- **Template lists with many fields** (`pages/FixedExpenseTemplatesPage.tsx`, FR-10 modelos de despesa fixa): the versioned-table form row (Nome first and focused on load; Enter saves and focus returns to Nome; the group is kept for the next entry) plus the master-data actions (Editar loads the row into the form with an "Editando o modelo … · Esc cancela" banner, ↑/↓ within the group, Desativar/Reativar; **no Excluir** when the spec has no delete). A checkbox enables dependent fields ("Empréstimo" → Total de parcelas / Parcelas restantes, disabled and dimmed otherwise). Optional text fields show the placeholder "opcional"; a free-text field with known values offers them in a `<datalist>` (Subgrupo). Values still to be supplied by the owner show a muted "a preencher". One titled table per group; inactive rows muted with an "Inativo" badge.
- **Month view with navigation** (`pages/FixedExpensesMonthPage.tsx`, FR-11 "Contas do mês"): the page title names the month ("Contas de novembro de 2026", `formatYearMonthLong`); icon buttons "Mês anterior"/"Próximo mês" (the next one disabled at the current month, never into the future) plus "Ir para o mês atual" when away; the month lives in the address (`?mes=2026-10`). One titled table per group with a status `Badge` (Pendente `secondary`, Pago `success`, Dispensado `outline`, muted row). A missing value the owner must supply elsewhere shows an `outline` badge ("Sem vencimento") and a short link on the same line ("Preencher", with a full `aria-label`) to the screen that fixes it. A one-off record shows an `outline` "Avulsa" badge. A month that is locked keeps its form visible but disabled, with the reason in the muted line under it.
- **Row actions on a status list** (`pages/FixedExpensesMonthPage.tsx`, FR-12): the last column holds text buttons that depend on the status: **Pagar** (`outline`) and **Dispensar** (`ghost`) on pending rows, **Desfazer** on paid rows, **Reativar** on dismissed ones; each has a full `aria-label` ("Pagar Luz"). Pagar opens a **secondary action panel** (`components/fixed-expenses/PayFixedExpenseForm.tsx`, primary-tinted border) in the Saídas field order: Data (today) then Valor (focused, pre-filled with the expected amount and selected), Meio de pagamento as a `ChoiceGroup` (digits 1–5) and the "Pago com dinheiro do caixa" checkbox; Enter pays, Esc cancels and returns focus to the row's Pagar button. Dismiss and undo ask with `window.confirm`, saying what happens. A "Pagamento" column shows "R$ 120,00 · 18/11/2026 · Dinheiro do caixa" (date and means muted).
- **One-off cleanup panel** (`components/fixed-expenses/ContaConversionPanel.tsx`, #13): a titled section that appears only while there is something to clean up, with a muted sentence explaining why, a dense table (one row per record, a `NativeSelect` for the target and a **Converter** button) and a `window.confirm` that says everything the action will do (e.g. reopen and close the day again). It disappears when the last record is done.
- **Report matrix** (Relatórios › Dia, FR-19, `components/reports/DayReportMatrix.tsx`): rows = tabs in display order, columns = payment methods + Total. A tab with sales is a row group of three sub-rows (Bruto, Taxa, Líquido) with the tab name as a `th scope="rowgroup"` (color dot) spanning them; a tab without sales is one dimmed row "Sem vendas" with "—" cells. Zero cells are muted, the Total column is `font-medium`, and a `tfoot` "Total do dia" group repeats the three measures. Below it, read-only tables reuse the entry screens' columns (Saídas with a fixed expense marked by an `outline` "Despesa fixa" badge; Sangrias) and the closing reuses `ClosedDaySummary`. The date field is focused on load and kept in the address (`?data=`).
- **Month report grid** (Relatórios › Mês – Entradas, FR-20, `pages/MonthIncomeReportPage.tsx`): the month's figures first, as three small cards (Entrada mensal, (−) Taxas, Líquido). Then one row per day (`th scope="row"`) and one column per tab (color dot) plus Total, with a `tfoot` "Total do mês". Days without sales are dimmed, and zero cells show a muted "—". To fit 9 tabs on a 1440 px screen, the grid uses tighter cells (`text-[13px]`, `px-2`). The month field is a native `<input type="month">`, focused on load, with `max` set to the current month and the month kept in the address (`?mes=`). The shared pieces are `components/reports/ReportMonthField.tsx` and `use-report-month.ts`.
- **Drill-down rows** (Relatórios › Mês – Despesas gerais, FR-21, `pages/MonthGeneralExpensesReportPage.tsx`): a category with entries has a ghost button in its name cell (chevron, `aria-expanded`, `aria-label` "Ver/Ocultar lançamentos de Kalunga"). Enter or Space opens a full-width row underneath with a nested table (`aria-label` "Lançamentos de Kalunga"). Empty categories have no button, are muted, and are indented to line up with the others. A group is a titled row ("Fornecedores de materiais") followed by its indented categories and a "Subtotal …" row, and the `tfoot` holds "Total geral".
- **Hub pages** (`/configuracoes`, `/cadastros`, `/despesas-fixas`): a column of link cards to the sub-pages, plus muted "em construção" cards for sections still to come. Sibling sub-pages may add links next to "← Área" (e.g. Maquininhas → Tabela de taxas).
- **Sub-pages** of an area (e.g. `/configuracoes/auditoria`) keep the area active in the sidebar and header, and show a "← Área" link under the page header.
- Layout components live in `src/components/layout/`: `AppShell`, `AppSidebar`, `PageHeader`, `ThemeToggle`.
- Naming: components in `PascalCase.tsx`, hooks in `use-kebab-case.ts`, one component per file. UI text is written in pt-BR directly in the component, since there is no i18n layer (pt-BR only, NFR-05).
