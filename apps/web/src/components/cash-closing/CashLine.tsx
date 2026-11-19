import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CashLineProps {
  /** "+", "−" or "=": how the line enters RN-07. */
  sign?: string;
  label: ReactNode;
  /** The value (formatted money, an input or a badge), right-aligned. */
  children: ReactNode;
  /** For tests and the E2E: e.g. "expected-cash". */
  testId?: string;
  strong?: boolean;
}

/**
 * One line of the cash closing (FR-08 / RN-07): sign, label and a right-aligned value. Lines
 * stack in a two-column grid, like the owner's paper sheet.
 */
export function CashLine({ sign, label, children, testId, strong }: CashLineProps) {
  return (
    <div
      className={cn(
        "flex min-h-9 items-center justify-between gap-4 border-b py-1 last:border-b-0",
        strong && "font-semibold",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-3 text-center text-muted-foreground" aria-hidden>
          {sign}
        </span>
        {label}
      </div>
      <div className="whitespace-nowrap text-right tabular-nums" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}
