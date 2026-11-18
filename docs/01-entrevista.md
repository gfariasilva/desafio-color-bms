# Interview log (decisions)

Legend: ✅ decided · ❓ OPEN QUESTION (ask the owner) · 🔮 future phase

## Round 1: Architecture

**Q1. How detailed is a sale record?** ✅
- Each sale is its own row (amount, aba, payment method, machine, installments).
- Each aba shows the sum of its rows.
- Daily and monthly totals are always calculated from the rows. Nobody types totals in.

**Q2. Users and devices** ✅
- Local app on **one shop PC**.
- 🔮 Viewing everything (reports, fixed expenses) on the PC and on the owner's phone is a later improvement, and only if it costs **R$ 0**.
  - Architecture note: build it as a **local web app** (a server running on the PC, used in the browser). That way phone access later is just configuration:
    - on the shop Wi-Fi, through the PC's address on the local network;
    - away from the shop, through a free tunnel or VPN such as Tailscale or Cloudflare Tunnel (to be evaluated).

**Q3. Simultaneous users** ✅
- One person enters data at a time.
- An embedded single-file database (e.g. SQLite) is enough. Read-only viewing from the phone later doesn't change this.

## Round 2: How a sale is paid, and machine fees

**Q4. Split payments and mixed purchases** ✅
- **1 row = 1 aba + 1 payment method.**
- A split payment, or one purchase from several abas, is entered as several rows.

**Q5. Machine fees** ✅
- Fee table by **machine × method (débito, crédito à vista, crédito parcelado, PIX through the machine) × number of installments**.
- Each rate has a "valid from" date. A sale stores the % applied and the net amount, so a later rate change never rewrites old days.
- ❓ OPEN: the current rates for PagSeguro and Mercado Pago.
- ❓ OPEN: does the shop use antecipação?

**Q6. Gross vs net; when money actually arrives** ✅
- **Saldo = Entradas brutas − Taxas de maquininha − Despesas.** Fees appear as their own line.
- Income counts on the **sale date**.
- 🔮 Tracking when card money reaches the bank (D+1, D+30, installments) is a future phase.

## Round 3: Corrections, cancellations and closing the day

**Q7. Mistakes, cancellations, refunds** ✅
- **Same day, while the day is open:** a sale can be edited or deleted freely.
- **A refund on an old sale:** an **estorno** (negative row) on **today's date**, with the same aba, method and machine, and a required reason.
- An **audit log** records every edit and deletion (who, when, before → after).

**Q8. Discounts** ✅
- No discount field. Only the amount actually charged is recorded.

**Q9. Fechamento de caixa and locking** ✅
- At closing the user enters the **troco inicial** and the **dinheiro contado**.
- **Esperado = troco inicial + vendas em dinheiro − despesas pagas em dinheiro do caixa − sangrias.**
- **Diferença = contado − esperado.**
- The day becomes **fechado**. Reopening it needs the admin password and a reason.
- Closing a month locks all of its days.
- Implication: expenses need a "paid from the drawer" flag, and there is a **sangria** record.

## Round 4: Expenses

**Q10. Daily, general and fixed expenses** ✅
- **One expense table**, with type = *geral* or *fixa*. "Saídas diárias" is the screen for entering general expenses on a given day.
- **Fixed expenses come from a monthly template**, created automatically each month with a vencimento and status *pendente*.
- When a bill is paid, the user enters the actual amount, the payment date, the payment method and whether it was paid from the drawer.
- **Empréstimos** have a set number of installments and stop on their own.
- The home screen shows a list of bills due soon or overdue.

**Q11. How categories relate** ✅
- Categories are **totally independent**, and each expense goes into **exactly one** category (e.g. "Kalunga" and "Acessórios" are separate totals). Nothing is counted twice.
- The person entering the expense picks its category.
- Consequence: expenses are not linked to sales abas, so **"abas mais lucrativas" = highest revenue**. Profit per aba is out of scope.

**Q12. Which month an expense counts in** ✅
- The **payment date** decides the month (regime de caixa).
- The due date is stored too.
- A pending bill only counts toward the saldo once it is paid.

## Round 5: Users, permissions and categories

**Q13. Users and permissions** ✅
- **One user: the business owner**, with a single profile (admin, full access). No roles, no admin password.
- Reopening a closed day only asks for an "Are you sure?" confirmation, plus the reason, which goes into the audit log.
- Decision taken by the interviewer (no login): there is **no login screen on the PC**. The PC's Windows account protects access.
  - 🔮 When phone access is enabled (future), a **password becomes required** for any access from outside the PC itself.

**Q14. Managing categories** ✅
- The owner can add, rename, deactivate and reorder categories, and the history keeps its link to the category (by ID).
- A category can only be deleted if it has never been used.
- The same rules apply to the fee table, payment methods and machines.

**Q15. CHAVEIRO listed twice** ✅
- It's a typo. There is one "Chaveiro" aba, so the list starts with **9 sales abas**.

## Round 6: OneDrive

**Q16. Direction of sync** ✅
- **One-way: system → spreadsheets.** The system is the **only source of truth**.
- The owner's goal is to **stop using Excel for good**. The spreadsheets are only a human-readable backup in case the system fails.
- Changes made in the spreadsheets are never read back. All corrections are made in the system.
- No warning note at the top of the sheets.
- **No import** of past spreadsheets.
  - Consequence: dashboards and "vs. last month" comparisons start empty. Comparisons work from the second month of use.

**Q17. How files reach OneDrive** ✅
- The system writes .xlsx files into the PC's **local OneDrive folder**, and the OneDrive desktop app syncs them.
- The settings screen has a folder path field.
- There is no Microsoft API integration.

**Q18. When files are generated, and naming** ✅
- **Daily sheet:** generated when the day is closed, and regenerated whenever a reopened day is closed again.
- **Monthly sheet:** updated each time a day is closed, and finalised when the month is closed.
- **Layout:** `<pasta>/AAAA/MM - Mês/Diária AAAA-MM-DD.xlsx` and `<pasta>/AAAA/MM - Mês/Mensal AAAA-MM.xlsx`.
- **On failure** (file open in Excel, folder missing): the export is queued, a "backup pendente" warning is shown, and the system retries automatically.

## Round 7: Non-functional requirements

**Q19. Backing up the system's own database** ✅
- A copy of the database file is saved to `<pasta>/_backup-sistema/` each time a day is closed, and once a day automatically.
- **Retention:** the last 30 daily copies, plus one copy per month kept indefinitely.
- A "Restaurar backup" button in settings.

**Q20. The shop PC** ✅
- **Windows 11.**
- The app starts with Windows, and a desktop shortcut opens it in the browser.
- It works **fully offline**. Only the OneDrive upload needs internet, and it catches up later.

**Q21. Budget, privacy, language** ✅
- **Budget: R$ 0/month.** No paid hosting, services or libraries.
- **LGPD:** no customer data is stored (no name or CPF on sales). The only sensitive data is the employee's salary amount.
- **Language:** the interface is **pt-BR** (R$ 1.234,56, dd/mm/aaaa, timezone America/Sao_Paulo).
- **Code and code documentation in English.**

## Round 8: Reports and dashboards

**Q22. Dashboards** ✅
- The MVP covers only these three questions:
  1. How is this month going compared to last month? (income, expenses, fees, saldo, % change)
  2. Which abas sell the most? (revenue ranking for the month, with change vs. last month)
  3. Daily income × expenses over the last 7 or 30 days.
- 🔮 Later: fees per machine, breakdown by payment method, profit trends, sales by weekday, projection of the month's saldo.
  - Fee totals still appear as a line in the Resumo mensal.

**Q23. Report screens** ✅
- **Dia:** aba × payment method, gross and net, plus the fechamento de caixa.
- **Mês – Entradas:** a grid of days × abas, plus totals per payment method.
- **Mês – Despesas gerais:** per category.
- **Mês – Despesas fixas:** per item, with paid/pending status.
- **Resumo mensal:** Total despesas, Entrada mensal, Taxas, Saldo.
- Every screen has a date/month picker. No printing.

**Q24. Home-screen alerts** ✅
- Fixed bills due within 3 days, or overdue.
- "Backup pendente".
- A previous day not closed.
- A cash difference on the last fechamento above a configurable limit (assumed default: R$ 10,00).
- Alerts appear only inside the app.
