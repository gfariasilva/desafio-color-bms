import { formatCents, formatInstantTime, type Sale } from "@color-bms/core";

/** "das 10:05 de R$ 25,00": how a sale is named in button labels and the edit banner (FR-03). */
export function describeSale(sale: Sale): string {
  return `das ${formatInstantTime(sale.createdAt)} de ${formatCents(sale.grossCents)}`;
}
