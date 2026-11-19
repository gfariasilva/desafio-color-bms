import { z } from "zod";
import { INVALID_BODY } from "../catalog/categories";
import {
  EXPENSE_DESCRIPTION_MAX,
  expenseAmountCentsSchema,
  expensePaymentMeansSchema,
  type ExpenseStatus,
} from "../expenses/expenses";
import type { ExpenseTotalsRow } from "../expenses/expense-totals";
import { expensesTotalCents } from "../expenses/expense-totals";
import { formatYearMonth } from "../format/date";
import { civilDateSchema } from "../payments/card-fees";
import { periodLockError, saleDateError } from "../sales/sale-rules";
import type { CivilDate } from "../time/civil-date";
import type { YearMonth } from "../time/year-month";
import { FIXED_EXPENSE_GROUPS } from "./fixed-expense-templates";
import { fixedExpenseSchema } from "./fixed-expenses";

/**
 * FR-12: paying or dismissing a fixed expense ("conta do mês"); FR-13: loan installments.
 * Pure rules: the server passes "today" and the period status in.
 *
 * A fixed expense is born `pending` (FR-11). Paying it records the amount, payment date,
 * means and "pago do caixa", like a general expense (FR-06); it then counts in the month of
 * its **payment date** (RN-09, cash basis). Dismissing it takes it out of every total and
 * alert. Both can be undone ("Desfazer"/"Reativar") while the period is open (RN-14).
 */

export const FIXED_EXPENSE_PAYMENT_TEXTS = {
  notFound: "Conta não encontrada.",
  alreadyPaid: "Esta conta já está paga.",
  dismissedCannotPay: "Esta conta está dispensada. Reative-a para pagar.",
  paidCannotDismiss: "Esta conta já está paga. Desfaça o pagamento para dispensá-la.",
  alreadyDismissed: "Esta conta já está dispensada.",
  alreadyPending: "Esta conta já está pendente.",
} as const;

const REASON_MAX = 200;

/**
 * Body of POST /api/fixed-expenses/:id/pay (FR-12). "Pago do caixa" follows FR-06: only with
 * Dinheiro, yes by default (`resolvePaidFromTill`).
 */
export const payFixedExpenseInputSchema = z.object(
  {
    amountCents: expenseAmountCentsSchema,
    paymentDate: civilDateSchema("Data inválida."),
    paymentMeans: expensePaymentMeansSchema,
    paidFromTill: z.boolean({ message: "Informe se foi pago com dinheiro do caixa." }).optional(),
  },
  INVALID_BODY,
);
export type PayFixedExpenseInput = z.input<typeof payFixedExpenseInputSchema>;
export type ParsedPayFixedExpenseInput = z.output<typeof payFixedExpenseInputSchema>;

/**
 * Body of POST /api/fixed-expenses/:id/dismiss and /undo: an optional reason for the audit
 * log (FR-18). No body at all is fine.
 */
export const fixedExpenseStatusChangeInputSchema = z
  .object(
    {
      reason: z
        .string({ message: "Motivo inválido." })
        .trim()
        .max(REASON_MAX, `O motivo pode ter até ${REASON_MAX} caracteres.`)
        .nullable()
        .optional()
        .transform((text) => text || null),
    },
    INVALID_BODY,
  )
  .optional()
  .transform((input) => ({ reason: input?.reason ?? null }));
export type FixedExpenseStatusChangeInput = z.input<typeof fixedExpenseStatusChangeInputSchema>;

type PeriodStatus = { dayClosed: boolean; monthClosed: boolean };

/**
 * Why a fixed expense cannot change; the server maps `kind` to the HTTP answer:
 * `status` (409, wrong status), `future` (400, RN-15), `locked` (409, closed day or month).
 */
export interface FixedExpenseBlock {
  kind: "status" | "future" | "locked";
  message: string;
}

function block(kind: FixedExpenseBlock["kind"], message: string | null): FixedExpenseBlock | null {
  return message === null ? null : { kind, message };
}

/**
 * FR-12: can this entry be paid on `paymentDate`? In order: it is pending; no future date
 * (RN-15); the payment day and month are open (RN-14, A-16: "a data de pagamento não pode
 * cair em dia fechado", even for bills paid through the bank). The reference month does not
 * matter: October's bill can be paid in November (cash basis).
 */
export function payFixedExpenseBlock(
  entry: { status: ExpenseStatus },
  paymentDate: CivilDate,
  today: CivilDate,
  status: PeriodStatus,
): FixedExpenseBlock | null {
  if (entry.status === "paid") return block("status", FIXED_EXPENSE_PAYMENT_TEXTS.alreadyPaid);
  if (entry.status === "dismissed") {
    return block("status", FIXED_EXPENSE_PAYMENT_TEXTS.dismissedCannotPay);
  }
  return (
    block("future", saleDateError(paymentDate, today)) ??
    block("locked", periodLockError(paymentDate, status, "para registrar pagamentos nessa data."))
  );
}

function referenceMonthLockError(referenceMonth: YearMonth): string {
  return `O mês ${formatYearMonth(referenceMonth)} está fechado. Reabra o mês para alterar as contas dele.`;
}

/**
 * FR-12: only a pending entry is dismissed, and not in a closed reference month (RN-14): a
 * dismissed entry has no date, so its reference month is the period it belongs to.
 */
export function dismissFixedExpenseBlock(
  entry: { status: ExpenseStatus; referenceMonth: YearMonth },
  referenceMonthClosed: boolean,
): FixedExpenseBlock | null {
  if (entry.status === "paid") {
    return block("status", FIXED_EXPENSE_PAYMENT_TEXTS.paidCannotDismiss);
  }
  if (entry.status === "dismissed") {
    return block("status", FIXED_EXPENSE_PAYMENT_TEXTS.alreadyDismissed);
  }
  return referenceMonthClosed
    ? block("locked", referenceMonthLockError(entry.referenceMonth))
    : null;
}

/**
 * FR-12 "Desfazer" / "Reativar": back to pending. A payment is undone only while its payment
 * day and month are open (RN-14: the record is dated on that day); a dismissal only while the
 * reference month is open.
 */
export function undoFixedExpenseBlock(
  entry: { status: ExpenseStatus; referenceMonth: YearMonth; paymentDate: CivilDate | null },
  paymentDayStatus: PeriodStatus,
  referenceMonthClosed: boolean,
): FixedExpenseBlock | null {
  if (entry.status === "pending") {
    return block("status", FIXED_EXPENSE_PAYMENT_TEXTS.alreadyPending);
  }
  if (entry.status === "paid" && entry.paymentDate) {
    return block(
      "locked",
      periodLockError(entry.paymentDate, paymentDayStatus, "para desfazer este pagamento."),
    );
  }
  return referenceMonthClosed
    ? block("locked", referenceMonthLockError(entry.referenceMonth))
    : null;
}

/** The loan fields of a template that FR-13 reads. */
export interface LoanTemplate {
  isLoan: boolean;
  installmentsTotal: number | null;
  installmentsRemaining: number | null;
}

/**
 * FR-13: paying a loan's entry pays installment `total − remaining + 1` and leaves one less.
 * The number is decided at payment time, so two pending entries (last month's still unpaid)
 * are numbered in the order they are paid. Null (no countdown) for a regular bill, a loan
 * whose installments are still blank (Q-06), or a loan with nothing left: the payment is
 * still recorded.
 */
export function loanPayment(
  template: LoanTemplate,
): { installmentNumber: number; installmentsRemaining: number } | null {
  const { isLoan, installmentsTotal: total, installmentsRemaining: remaining } = template;
  if (!isLoan || total === null || remaining === null || remaining <= 0) return null;
  return { installmentNumber: total - remaining + 1, installmentsRemaining: remaining - 1 };
}

/**
 * FR-13: undoing a counted loan payment gives the installment back (never above the total).
 * The server calls it only when the payment was counted (the entry has an installment number).
 */
export function loanUndo(template: LoanTemplate): { installmentsRemaining: number } | null {
  const { isLoan, installmentsTotal: total, installmentsRemaining: remaining } = template;
  if (!isLoan || total === null || remaining === null || remaining >= total) return null;
  return { installmentsRemaining: remaining + 1 };
}

/**
 * RN-09: fixed expenses of the month = Σ amount of the `fixed` expenses with status **paid**
 * whose **payment date** falls in the month ("YYYY-MM"), whatever their reference month.
 * Pending and dismissed entries do not count.
 */
export function fixedExpensesOfMonthCents(
  rows: readonly ExpenseTotalsRow[],
  yearMonth: YearMonth,
): number {
  return expensesTotalCents(
    rows.filter(
      (row) =>
        row.type === "fixed" && row.status === "paid" && row.paymentDate?.slice(0, 7) === yearMonth,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// #13: converting the pilot's interim "CONTA:" sangrias.

/** The audit reason of every write of a conversion (backlog #13). */
export const CONTA_CONVERSION_REASON = "Conversão CONTA: piloto";

/**
 * #9 interim rule: a bill paid with cash from the till was recorded as a sangria whose note
 * starts with "CONTA:" (e.g. "CONTA: Luz outubro"). Returns the bill's name after the prefix
 * ("" when there is none), or null when the note is not a bill. Any letter case.
 */
export function contaBillName(note: string | null): string | null {
  const match = /^\s*conta:(.*)$/is.exec(note ?? "");
  return match ? match[1]!.trim().replace(/\s+/g, " ") : null;
}

const nameMessage = "Informe o nome da conta.";

/**
 * Body of POST /api/conta-conversions/:withdrawalId: pay a pending entry the owner picks, or a
 * new one-off bill of the sangria's month with this name and group.
 */
export const convertContaInputSchema = z.discriminatedUnion(
  "target",
  [
    z.object({
      target: z.literal("existing"),
      fixedExpenseId: z
        .number({ message: "Escolha a conta." })
        .int("Escolha a conta.")
        .positive("Escolha a conta."),
    }),
    z.object({
      target: z.literal("one_off"),
      name: z
        .string({ message: nameMessage })
        .transform((text) => text.normalize("NFC").trim().replace(/\s+/g, " "))
        .pipe(
          z
            .string()
            .min(1, nameMessage)
            .max(
              EXPENSE_DESCRIPTION_MAX,
              `O nome deve ter no máximo ${EXPENSE_DESCRIPTION_MAX} caracteres.`,
            ),
        ),
      group: z.enum(FIXED_EXPENSE_GROUPS, { errorMap: () => ({ message: "Grupo inválido." }) }),
    }),
  ],
  { errorMap: () => ({ message: "Escolha a conta." }) },
);
export type ConvertContaInput = z.input<typeof convertContaInputSchema>;
export type ParsedConvertContaInput = z.output<typeof convertContaInputSchema>;

/** A CONTA: sangria still to convert. */
export const contaCandidateSchema = z.object({
  id: z.number().int().positive(),
  date: z.string(),
  amountCents: z.number().int(),
  note: z.string(),
  /** The name after "CONTA:", to pre-fill a new one-off bill. */
  suggestedName: z.string(),
  /** The conversion reopens and closes the day again (RN-14). */
  dayClosed: z.boolean(),
  /** RN-14: a closed month must be reopened (FR-17) before converting; null if open. */
  lock: z.string().nullable(),
});
export type ContaCandidate = z.infer<typeof contaCandidateSchema>;

/** Response of GET /api/conta-conversions. */
export const contaCandidatesResponseSchema = z.object({
  /** Oldest first. */
  withdrawals: z.array(contaCandidateSchema),
  /** Every pending fixed expense, any month, newest reference month first. */
  pendingExpenses: z.array(fixedExpenseSchema),
});
export type ContaCandidatesResponse = z.infer<typeof contaCandidatesResponseSchema>;
