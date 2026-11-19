import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";
import {
  DAY_REOPEN_REASON_MAX,
  formatCivilDate,
  reopenDayInputSchema,
  type ReopenDayInput,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReopenDayPanelProps {
  /** The closed day (FR-09). */
  date: string;
  /** Reopens the day; rejects with an Error whose message is pt-BR (shown in the alert). */
  onReopen: (input: ReopenDayInput) => Promise<unknown>;
}

/**
 * FR-09: "Reabrir dia" under a closed day's summary. The button opens a confirmation card in
 * place (no modal, spec §2 "Tem certeza?" + motivo): focus goes to the reason, Enter reopens,
 * Esc cancels and returns focus to the button. After a reopening the page shows the closing
 * form again (a new closing is required).
 */
export function ReopenDayPanel({ date, onReopen }: ReopenDayPanelProps) {
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
    const parsed = reopenDayInputSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      reasonField.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    try {
      // On success the page replaces this panel with the closing form.
      await onReopen(parsed.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível reabrir o dia.");
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
        Reabrir dia
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
          aria-label="Reabrir o dia"
          className="space-y-3"
        >
          <p className="text-sm">
            <span className="font-medium">Tem certeza?</span> O dia {formatCivilDate(date)} volta a
            aberto e precisará ser fechado de novo. O fechamento atual fica na auditoria. Esc
            cancela.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">Motivo da reabertura</Label>
            <Input
              id="reopen-reason"
              ref={reasonField}
              autoComplete="off"
              maxLength={DAY_REOPEN_REASON_MAX}
              placeholder="ex.: venda esquecida"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              Reabrir dia
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
