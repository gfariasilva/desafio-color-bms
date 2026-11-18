import { formatCents, formatInstantTime, type Expense } from "@color-bms/core";

/** "das 10:05 de R$ 45,00": how an expense is named in button labels and the edit banner. */
export function describeExpense(expense: Expense): string {
  return `das ${formatInstantTime(expense.createdAt)} de ${formatCents(expense.amountCents)}`;
}
