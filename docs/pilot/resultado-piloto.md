# Pilot results: success criteria, visits and the exit decision (#27)

For the developer. Filled in during the parallel period and at its end. It is the record for #27's acceptance criteria:

- CS-1 to CS-5 have a recorded measurement or status at the end of the parallel period;
- every difference found in the comparison has a reason and, for bugs, a backlog item ([`conferencia.md`](conferencia.md));
- the owner stops the daily Excel only when #21 is live and CS-3 held for 2 weeks; otherwise the parallel period is extended.

Go-live date: ___/___/______ · Planned end of the parallel period (go-live + 14 days): ___/___/______

## Success criteria (spec §1.4)

| # | Criterion | How it is measured | Result | Date | Status |
|---|---|---|---|---|---|
| CS-1 | No hand-made spreadsheets within **1 month** of go-live. | Owner's report at the end of month 1: no manual spreadsheet after the parallel period. | | | |
| CS-2 | A sale takes **≤ 10 s**. | Stopwatch, average of 10 sales ([`treinamento.md`](treinamento.md)). Budget E2E test (`e2e/`) green. | avg ___ s | | |
| CS-3 | Daily and monthly totals match **to the cent** during the parallel period. | [`conferencia.md`](conferencia.md): days compared, days matching, differences by reason (S/D/E/O). | ___ / ___ days; S ___ D ___ E ___ O ___ | | |
| CS-4 | Closing the day takes **≤ 3 min**. | Stopwatch, training day and one real day. | ___ min / ___ min | | |
| CS-5 | Each closed day's backup reaches OneDrive **the same day**, when there is internet. | Every visit: each closed day of the period has a `color-AAAA-MM-DD_HHMM.db` in `<OneDrive>\_backup-sistema\` dated that day, also visible on onedrive.com. | ___ / ___ days | | |

Status: **met**, **not met** (with the backlog item or action), or **pending** (with the date it will be measured; CS-1 is measured at the end of month 1).

## System bugs found (reason S)

| Date found | Description | Backlog item | Fixed in version |
|---|---|---|---|
| | | | |

## Weekly visits

About 20 minutes, at the time agreed with the owner. Bring the USB stick with the latest zip ([`install.md`](install.md) §5).

Checklist for each visit:

- [ ] Início: no alert, all Verificações "OK", "Último backup" recent.
- [ ] `conferencia.md` of the week reviewed with the owner; every difference has a reason.
- [ ] CS-5 checked in the OneDrive folder.
- [ ] Feedback written below; bugs and requests become backlog items.
- [ ] Update installed with `atualizar.cmd`, if there is a new version; Início shows it.

| Date | Version before → after | Feedback from the owner | Actions / backlog items |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

## Exit decision (spec §9.5 item 5)

The owner stops the daily Excel only when **both** are true:

- [ ] **#21** (daily `.xlsx` in OneDrive) is installed on the shop PC, and the files of the last days are in the OneDrive folder.
- [ ] **CS-3 held for 2 weeks**: 14 days compared, and every difference explained, with no open **S** bug that affects totals.

Decision date: ___/___/______

- [ ] **Stop the daily Excel.** The system's spreadsheets are the backup from now on.
- [ ] **Extend the parallel period** until ___/___/______. Reason (missing item or open bug): ____________________

The monthly Excel is compared at the end of month 1 (M5, CS-3 monthly) and dropped with CS-1.
