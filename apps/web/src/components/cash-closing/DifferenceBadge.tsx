import { cashDifferenceLabel } from "@color-bms/core";
import { Badge } from "@/components/ui/badge";

/**
 * RN-07: the cash difference in words, highlighted: green for a surplus (sobra), destructive
 * for a shortage (falta), neutral when there is none. Null while it cannot be computed.
 */
export function DifferenceBadge({ differenceCents }: { differenceCents: number | null }) {
  if (differenceCents === null) return <span className="text-muted-foreground">—</span>;
  const variant =
    differenceCents > 0 ? "success" : differenceCents < 0 ? "destructive" : "secondary";
  return (
    <Badge variant={variant} className="text-sm">
      {cashDifferenceLabel(differenceCents)}
    </Badge>
  );
}
