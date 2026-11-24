import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatVariation } from "@color-bms/core";
import { TableCell } from "@/components/ui/table";

/**
 * RN-11: a variation cell ("+8,7%", "−38,8%", "0,0%", "—"). The arrow only repeats the sign:
 * there is no good/bad colour (more Taxas means more card sales), as the design system says.
 */
export function VariationCell({ tenths }: { tenths: number | null }) {
  const Arrow = tenths === null ? null : tenths > 0 ? ArrowUp : tenths < 0 ? ArrowDown : Minus;
  return (
    <TableCell className="whitespace-nowrap text-right tabular-nums">
      <span className="inline-flex items-center justify-end gap-1">
        {Arrow ? <Arrow aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {formatVariation(tenths)}
      </span>
    </TableCell>
  );
}
