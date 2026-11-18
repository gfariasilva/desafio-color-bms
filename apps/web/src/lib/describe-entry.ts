import { formatCents, formatInstantTime } from "@color-bms/core";

/**
 * "das 10:05 de R$ 45,00": how a registered entry (expense, sangria) is named in button labels
 * and the edit banner.
 */
export function describeEntry(entry: { createdAt: string; amountCents: number }): string {
  return `das ${formatInstantTime(entry.createdAt)} de ${formatCents(entry.amountCents)}`;
}
