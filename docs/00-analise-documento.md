# Step 1: Analysis of the owner's document (DESAFIO_COLOR.docx)

> Working notes for the requirements interview. The final spec (`docs/spec.md`) will be written in Portuguese, keeping the owner's terms.

## 1. What I understood

### Today's process
- **Planilha diária**: one spreadsheet per day, made by hand. It has one **aba** (tab) per sales line, plus a tab for the day's sporadic expenses.
- **Planilhas mensais**: income (entradas), general expenses (despesas gerais) and fixed expenses (despesas fixas), ending in the **saldo mensal**.

### Entities
| Entity | Values from the document |
|---|---|
| **Categoria de venda (aba de entrada)** | Acessórios, Carimbos, Cartuchos compatíveis, Recargas, Papelaria, Chaveiro (listed twice), Toner, Serviços de copiadora, Personalizados |
| **Forma de pagamento** | Dinheiro, Cartão de débito, Cartão de crédito, PIX/Depósito, Boleto bancário |
| **Maquininha** | PagSeguro, Mercado Pago, each with its own % fee |
| **Categoria de despesa geral** | Acessórios, Carimbos, Chaves, Despesas gerais (loja), Despesas moto, Abastecimento moto, Diversos, Alimentação, and a group **Fornecedores de materiais** (Casa Forte, Nova Supri, Canal Verde, Jandaia, Kalunga, Suzano, Outros fornecedores) |
| **Despesa fixa** | *Gerais*: Água, Luz, Aluguel, Contador, Funcionário, GPS, Seguro loja, Telefonia (Vivo fixo, Vivo móvel), Banco, Empréstimos. *Taxas governo*: DAS, DARE, DARF, TFE |

### Flows
1. **Daily sales entry**: the amount per aba × forma de pagamento. For card payments, show both the **valor cheio** (full amount) and the **valor real** (net, after that machine's fee).
2. **Daily expense entry (saídas diárias)**: sporadic expenses that use the general-expense categories and count toward the monthly general-expense total.
3. **Monthly expenses**: general and fixed expenses.
4. **OneDrive**: the system **creates the daily sheet as a backup** (the local DB holds the data) and **reads, creates and edits** sheets (for example the monthly one). The user sets the link or path.

### Reports and totals
- **Daily**: total per payment method inside each aba, total per aba, total of the day.
- **Monthly income**: each day's total per aba, totals per payment method, month total.
- **Monthly general expenses**: total per category and grand total.
- **Monthly fixed expenses**: total per item and grand total.
- **Bottom line**: Total geral de despesas, Entrada mensal, **Saldo mensal**.
- **Dashboards (later)**: comparison with last month, expenses vs income over the last 7 days, most profitable or trending abas.
- **Category management**: add and remove categories (abas).

## 2. Ambiguities and contradictions
1. **CHAVEIRO is listed twice** among the sales abas. It is probably a duplicate. It could also mean two different things, for example key copying vs keychains, or a service vs a product.
2. **The same names appear on both sides.** Acessórios and Carimbos are both sales abas and expense categories, and "Chaves" (expense) probably buys stock for "Chaveiro" (sales). Are those expenses the **cost of goods** for that sales line? If so, the owner can see the margin per line. If not, "abas mais lucrativas" can only mean "abas with the most revenue".
3. **Fornecedores de materiais**: unclear whether it is a category group with one sub-item per supplier, or a supplier attribute on any expense. If he buys stamp material from Kalunga, it is unclear whether that goes under Carimbos or Kalunga, and it must not be counted twice.
4. **Whether Entrada mensal and Saldo mensal are gross or net of machine fees** is not stated. This is the most important formula in the document.
5. **PIX/Depósito**: PIX can be received through the maquininha (with a fee) or straight to the bank account (usually free). Deposits have no fee. It is unclear whether PIX ever has a fee.
6. **Boleto bancário** has no issuer, no fee and no payment timing. A boleto is usually paid **days later**, so it is unclear whether income counts on the day of sale or on the day it is paid.
7. **Credit card fees** depend on the number of installments (1x, 2–6x, 7–12x) and on whether he takes early payment (antecipação). The document shows one % per machine.
8. **"Valor cheio" vs "valor real"** is given for card payments. Fees on other methods are not covered.
9. **Saídas diárias use "the same categories" as Despesas Gerais.** It is unclear whether a fixed expense (for example paying the Luz bill in cash from the drawer) can also be entered on the daily sheet. If it can, it could be **counted twice**.
10. **The OneDrive role contradicts itself.** The daily sheet is "backup only", but the system must also "read" and "edit" sheets such as the monthly one. If people can edit the monthly sheet in Excel and the system reads it back, the sheet is a **second source of truth**.
11. **The layout of the monthly income sheet is unclear.** "Somatória do dia de cada aba" could mean a grid of days × abas, or days × payment methods, or both.
12. **Fixed vs variable**: Funcionário (salary, 13º, férias, vale), Empréstimos (installments ending on a date) and Banco (fees vary) are listed as "fixas", but their amounts change.
13. **"Remover categorias"**: a category that has historical entries cannot simply be deleted.
14. Typo: "EM CASA FORMA" means "em cada forma". DARE + TFE + GPS point to **São Paulo** (state ICMS and city TFE).

## 3. Implicit requirements (assumed but not written)
- A **fee table** per machine × payment method × number of installments, with **history** (fees change, and past days must keep the fee in effect at the time).
- **The month's fixed expenses are created automatically** (a recurring template), with **due date (vencimento) vs payment date** and a status (paid or pending).
- **Cash drawer control** (troco inicial, sangria, fechamento), at least to check that the cash counted matches the cash recorded.
- **How each expense was paid** (cash from the drawer, card or bank). Without this, cash cannot be reconciled.
- **Brazilian formats**: R$ 1.234,56, dd/mm/aaaa, Portuguese interface, .xlsx files that open well in Excel.
- **Importing the history** from current spreadsheets, if "comparação com mês passado" should work from day one.
- **Login and permissions** (an employee may enter sales but not see the saldo or the fixed expenses).
- **An audit trail** for edits to past days.
- **A way to correct a day** and **re-generate the backup sheet** after a correction.
- **Backups of the local DB** itself (OneDrive sheets are not a DB backup).

## 4. Edge cases and failure scenarios
- **Split payment**: one customer pays part in cash and part on card, or buys from several abas (paper plus copies).
- **Cancellation or refund**, chargeback, a sale entered by mistake, a card payment that was refused but recorded anyway.
- **A fee changes mid-month**, or the shop switches machines (a third machine appears).
- **Installment credit**: the gross amount is known today, but the money arrives over N months.
- **Rounding** of fees (per transaction vs on the day's total gives different cents).
- **Editing a past day after the backup sheet was generated**, or after the month was closed.
- **OneDrive**: the token expires, there is no internet, the **file is open/locked in Excel**, the file is renamed or moved, the quota is full, two files share the same name, or there is a sync conflict.
- **The PC dies, is stolen or gets ransomware.** If the DB is only local, all data is lost.
- **Two people enter data at the same time** (counter plus owner at home).
- **A category is renamed or removed** while history and existing spreadsheets still reference it.
- **A day with no sales** (Sunday, holiday): is a backup sheet still generated?
- **A month-end expense** is paid in the next month, or a bill is paid in advance.
- **A loan** whose installments end, or an employee who leaves.

## 5. Default assumptions (if nobody answers)
1. Sales are recorded **per transaction** (amount, aba, payment method, machine, installments). The daily totals are calculated from them.
2. **Chaveiro** is one category; the duplicate is a typo.
3. Each card payment stores the **gross amount, fee % and net amount**, using the rate in effect on the sale date.
4. **Entrada mensal = gross**. The report also shows **"Taxas de maquininha"** as a separate line, so **Saldo = Entradas brutas − Taxas − Despesas**.
5. PIX straight to the bank has no fee. PIX through a machine uses that machine's PIX rate.
6. Saídas diárias and despesas gerais are **the same table**. A "daily" expense is just one entered on the day, with no double counting.
7. Fixed expenses come from a monthly template, with a due date, a payment date and a status.
8. Categories can be **deactivated, never deleted** if they are used. Renaming keeps the history (linked by ID).
9. **The local DB is the only source of truth.** The OneDrive sheets are **export only** (read-only mirror), and edits made to them are not read back.
10. Portuguese UI, BRL, São Paulo timezone, a single store.
