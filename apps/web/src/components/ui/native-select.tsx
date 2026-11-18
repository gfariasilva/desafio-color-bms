import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native <select> styled like `Input`. Preferred over the Radix Select for simple filters:
 * it is fully keyboard-usable out of the box (type to jump, arrows to move) and needs no
 * extra dependency.
 *
 * Browsers do not submit a form when Enter is pressed on a <select>, so we do it here:
 * Enter submits in every data-entry form (NFR-05, design system).
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, onKeyDown, ...props }, ref) => (
    <select
      ref={ref}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const form = event.currentTarget.form;
        if (event.key !== "Enter" || event.defaultPrevented || !form) return;
        // Not cancelled, and submitted on the next tick: when Enter picks an option in an open
        // list (e.g. Firefox), the change event and its state update must happen first.
        setTimeout(() => form.requestSubmit(), 0);
      }}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
