import * as React from "react";
import { categoryNameKey } from "@color-bms/core";
import { cn } from "@/lib/utils";

export interface ChoiceOption {
  value: number;
  label: string;
  /** Optional color dot (category color, design system). */
  color?: string;
}

export interface ChoiceGroupProps {
  /** Visible label, also the group's accessible name. */
  label: string;
  options: readonly ChoiceOption[];
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

/** Letters typed within this time are one type-ahead search ("car" → Carimbos). */
const TYPE_AHEAD_MS = 800;

/**
 * A row of numbered options for the sale form (FR-01, NFR-05, CS-2): an ARIA radio group
 * with a single tab stop. On a focused option:
 * - a **digit 1–9** picks the option with that number (the number is shown on the option);
 * - **letters** jump to the first option whose name starts with them (case and accents
 *   ignored, the same rule as category names);
 * - **arrows** move and select, Home/End go to the ends;
 * - **Enter** submits the form, like every data-entry field (design system).
 *
 * A native <select> was not enough: its type-ahead cannot tell "Cartão de débito" from
 * "Cartão de crédito" quickly, and digits are the fastest way to fit the CS-2 budget.
 */
export const ChoiceGroup = React.forwardRef<HTMLDivElement, ChoiceGroupProps>(
  ({ label, options, value, onChange, disabled = false, className }, ref) => {
    const labelId = React.useId();
    const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
    const typed = React.useRef({ text: "", at: 0 });

    const selectedIndex = options.findIndex((option) => option.value === value);
    // Roving tab index: the checked option, or the first one, is the group's only tab stop.
    const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

    function choose(index: number) {
      const option = options[index];
      if (!option) return;
      onChange(option.value);
      buttons.current[index]?.focus();
    }

    function typeAhead(key: string, now: number): number {
      const previous = typed.current;
      const find = (text: string) => {
        const wanted = categoryNameKey(text);
        return options.findIndex((option) => categoryNameKey(option.label).startsWith(wanted));
      };
      let text = (now - previous.at < TYPE_AHEAD_MS ? previous.text : "") + key;
      let found = find(text);
      // No name starts with the whole text: start a new search with this letter.
      if (found < 0 && text.length > 1) {
        text = key;
        found = find(text);
      }
      typed.current = { text, at: now };
      return found;
    }

    function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
      const { key } = event;
      const last = options.length - 1;
      if (key === "Enter") {
        // A <button type="button"> does not submit; Enter must still save the form.
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return; // Alt+N opens areas
      let target: number | null = null;
      if (/^[1-9]$/.test(key)) target = Number(key) - 1;
      else if (key === "ArrowRight" || key === "ArrowDown") target = index === last ? 0 : index + 1;
      else if (key === "ArrowLeft" || key === "ArrowUp") target = index === 0 ? last : index - 1;
      else if (key === "Home") target = 0;
      else if (key === "End") target = last;
      else if (key === " ") target = index;
      else if (key.length === 1 && /\p{L}/u.test(key)) target = typeAhead(key, event.timeStamp);
      else return;
      event.preventDefault();
      if (target !== null && target >= 0 && target <= last) choose(target);
    }

    return (
      <div className={cn("space-y-1.5", className)}>
        <div id={labelId} className="text-sm font-medium leading-none">
          {label}
        </div>
        <div
          ref={ref}
          role="radiogroup"
          aria-labelledby={labelId}
          aria-disabled={disabled || undefined}
          className="flex flex-wrap gap-1.5"
        >
          {options.map((option, index) => {
            const checked = index === selectedIndex;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={index === tabStop ? 0 : -1}
                disabled={disabled}
                onClick={() => choose(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {index < 9 ? (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      checked ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {index + 1}
                  </span>
                ) : null}
                {option.color ? (
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                ) : null}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  },
);
ChoiceGroup.displayName = "ChoiceGroup";
