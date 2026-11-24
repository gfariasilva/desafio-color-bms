# Go-live checklist (#27, spec §9.5)

For the developer, done **with the owner** at the shop. Tick each step and write the date. UI labels are quoted as they appear on screen (pt-BR). The rest of the pilot:

- install and update: [`install.md`](install.md);
- training and stopwatch: [`treinamento.md`](treinamento.md);
- the owner's one-page guide (print it): [`guia-rapido.md`](guia-rapido.md);
- daily comparison during the parallel period (print it): [`conferencia.md`](conferencia.md);
- CS-1 to CS-5, weekly visits and the exit decision: [`resultado-piloto.md`](resultado-piloto.md).

## Timeline

| When | What |
|---|---|
| ~2 weeks before the 1st | Owner questions ([`owner-questions.md`](owner-questions.md)), install in trial mode ([`install.md`](install.md) §2), acceptance check on the shop PC (§7). |
| Last week before the 1st | Training (1 h) on trial data, stopwatch CS-2 and CS-4 ([`treinamento.md`](treinamento.md)), backup and restore test. Trial days: the owner types in some real sales next to his Excel. |
| Last open day before the 1st, after closing, or the 1st before opening | **Go-live reset** and the master data below. |
| From the 1st, 2 weeks | **Parallel period**: the owner keeps his Excel, and the totals are compared every day ([`conferencia.md`](conferencia.md)). Weekly visit. |
| End of the parallel period | Exit decision ([`resultado-piloto.md`](resultado-piloto.md)). |

## A. Before the go-live day (trial mode is fine)

| Done | Step | Date / who |
|---|---|---|
| [ ] | Owner questions answered and the answers written into `owner-questions.md` (and the spec, by the owner's decision). | |
| [ ] | Shop PC acceptance check in [`install.md`](install.md) §7 done (no window at logon, shortcut, offline, not reachable from the LAN, crash → restart, update). | |
| [ ] | **PC clock and time zone:** Configurações › Status do sistema › Verificações shows "OK" for the time zone (UTC−03:00) and the clock. Windows "Set time automatically" is on. | |
| [ ] | **OneDrive (Q-07):** the OneDrive app is signed in to the owner's account, has free space, and the chosen folder (e.g. `C:\Users\<user>\OneDrive\Color`) exists and syncs. Note the path: ____________________ | |
| [ ] | **Backup and manual restore test (NFR-07):** the checklist at the end of [`restaurar-backup.md`](restaurar-backup.md), done on the shop PC. | |
| [ ] | Training session done and CS-2 / CS-4 measured ([`treinamento.md`](treinamento.md)). | |
| [ ] | `guia-rapido.md` printed and left next to the PC. 14 pages of `conferencia.md` printed (or one booklet). | |
| [ ] | The pilot version on the shop PC is the latest (Início shows the version), so the go-live does not start with an update. | |

## B. Go-live reset (the 1st of a month, §9.5 items 2–3)

Do this when no sale of the new month has been made yet: after the last closing of the previous month, or on the 1st before the shop opens.

| Done | Step | Date / who |
|---|---|---|
| [ ] | In trial mode, close every open trial day (it does not matter, the trial data is archived, but it avoids confusion if the folder is opened later). | |
| [ ] | `iniciar-uso-real.cmd` in `%LOCALAPPDATA%\ColorBMS`: type **SIM**, confirm the OneDrive folder noted above. | |
| [ ] | Início: **no TREINO badge**, no "Pasta do OneDrive não configurada" or "Problema no PC" alert; Configurações › Status do sistema: all Verificações "OK". | |
| [ ] | `arquivo\data-treino-AAAA-MM-DD_HHMM\` exists (the trial data is kept, not deleted). | |

## C. Master data in the real database (right after the reset)

| Done | Step | Date / who |
|---|---|---|
| [ ] | **Fee table (Q-01, RN-01):** Cadastros › Taxas: every machine × method × installment range the owner uses, with the fees from the apps or the contract, valid from the 1st. Check one card sale per machine on the screen preview against the machine's app. | |
| [ ] | **Tabs (Cadastros › Abas de venda):** same names and the same order as the owner's daily Excel, so the comparison is line by line. Deactivate the ones he doesn't use. | |
| [ ] | **Expense categories (Cadastros › Categorias de despesa):** reviewed with the owner, including the Fornecedores group. | |
| [ ] | **Payment methods and machines:** PIX direct vs PIX on the machine (Q-03) as the owner answered. | |
| [ ] | **Fixed-expense templates (Q-05, Q-06):** Despesas fixas › Modelos: each monthly bill with its due day and expected amount; each loan with installment amount, total and remaining installments. | |
| [ ] | Despesas fixas › Contas do mês: the month's bills are generated and match the owner's list. | |

## D. The first real day

| Done | Step | Date / who |
|---|---|---|
| [ ] | The owner registers the day's sales, expenses and sangrias in the system **and** in his Excel. | |
| [ ] | First closing (Fechamento): "Troco inicial" is empty and the owner types it by hand (§9.5 item 3, FR-08). Value: R$ ________ | |
| [ ] | After the closing: Configurações › Status do sistema › "Último backup" shows today, and the file is in `<OneDrive>\_backup-sistema\` and synced (cloud icon with a check). | |
| [ ] | First line of [`conferencia.md`](conferencia.md) filled in. | |

Go-live date: ___/___/______ · Version: ________
