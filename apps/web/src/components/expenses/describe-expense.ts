import type { Expense } from "@color-bms/core";
import { describeEntry } from "@/lib/describe-entry";

/** "das 10:05 de R$ 45,00": how an expense is named in button labels and the edit banner. */
export function describeExpense(expense: Expense): string {
  return describeEntry(expense);
}
