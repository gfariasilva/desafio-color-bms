import { formatCents } from "@color-bms/core";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** A right-aligned money cell; `negative` turns it red (a negative Saldo, FR-23). */
export function MoneyCell({ cents, negative = false }: { cents: number; negative?: boolean }) {
  return (
    <TableCell
      className={cn("whitespace-nowrap text-right tabular-nums", negative && "text-destructive")}
    >
      {formatCents(cents)}
    </TableCell>
  );
}
