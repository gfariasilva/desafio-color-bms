import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { RotateCcw } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReopenPanelProps<Input extends { reason: string }> {
  /** The button and submit text, e.g. "Reabrir dia" or "Reabrir mês". */
  actionLabel: string;
  /** The form's accessible name, e.g. "Reabrir o dia". */
  formLabel: string;
  /** The "Tem certeza?" text after the bold question. */
  warning: ReactNode;
  /** The id of the reason field (unique on the page). */
  reasonId: string;
  reasonMax: number;
  placeholder: string;
  /** The core schema of the body ({ reason }), so the messages match the server's. */
  schema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  /** The fallback error when the rejection is not an Error. */
  failureMessage: string;
  /** Reopens; rejects with an Error whose message is pt-BR (shown in the alert). */
  onReopen: (input: Input) => Promise<unknown>;
}

/**
 * FR-09 / FR-17: a reopen button that opens a confirmation card in place (no modal, spec §2
 * "Tem certeza?" + motivo): focus goes to the reason, Enter reopens, Esc cancels and returns
 * focus to the button.
 */
export function ReopenPanel<Input extends { reason: string }>({
  actionLabel,
  formLabel,
  warning,
  reasonId,
  reasonMax,
  placeholder,
  schema,
  failureMessage,
  onReopen,
}: ReopenPanelProps<Input>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const reasonField = useRef<HTMLInputElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  // Focus moves only after the owner opened or cancelled the card, never on the first render.
  const focusTarget = useRef<"reason" | "button" | null>(null);

  useEffect(() => {
    if (focusTarget.current === "reason") reasonField.current?.focus();
    if (focusTarget.current === "button") reopenButton.current?.focus();
    focusTarget.current = null;
  }, [open]);

  function start() {
    focusTarget.current = "reason";
    setOpen(true);
  }

  function cancel() {
    focusTarget.current = "button";
    setOpen(false);
    setReason("");
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = schema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      reasonField.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    try {
      // On success the page replaces this panel.
      await onReopen(parsed.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : failureMessage);
      setPending(false);
    }
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      cancel();
    }
  }

  if (!open) {
    return (
      <Button ref={reopenButton} type="button" variant="outline" className="mt-3" onClick={start}>
        <RotateCcw aria-hidden />
        {actionLabel}
      </Button>
    );
  }

  return (
    <Card className="mt-3 max-w-xl border-destructive/40">
      <CardContent className="p-4">
        <form
          onSubmit={submit}
          onKeyDown={cancelOnEscape}
          noValidate
          aria-label={formLabel}
          className="space-y-3"
        >
          <p className="text-sm">
            <span className="font-medium">Tem certeza?</span> {warning} Esc cancela.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Motivo da reabertura</Label>
            <Input
              id={reasonId}
              ref={reasonField}
              autoComplete="off"
              maxLength={reasonMax}
              placeholder={placeholder}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {actionLabel}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
              Cancelar
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
