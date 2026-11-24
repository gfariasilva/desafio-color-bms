import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { BACKUP_RESTORE_REASON_MAX, restoreRequestSchema } from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RestoreConfirmCardProps {
  /** What is restored, e.g. "o backup de 18/11/2026 15:00 (OneDrive)". */
  what: string;
  /** The backup's date and time "18/11/2026 15:00", or null when the file name has none. */
  backupAt: string | null;
  /** Restores; rejects with an Error whose message is pt-BR (shown in the alert). */
  onConfirm: (reason: string) => Promise<unknown>;
  /** Esc or Cancelar: the page closes the card and puts the focus back. */
  onCancel: () => void;
}

/**
 * FR-32 (spec §2 "Tem certeza?" + motivo): the restore confirmation, in place like the
 * reopen panels (no modal). Focus starts on the reason, Enter restores, Esc cancels.
 */
export function RestoreConfirmCard({
  what,
  backupAt,
  onConfirm,
  onCancel,
}: RestoreConfirmCardProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const reasonField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    reasonField.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    // The same reason rule as the server (the source does not matter here).
    const parsed = restoreRequestSchema.safeParse({ source: "upload", reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      reasonField.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    try {
      // On success the page replaces this card with the restart notice.
      await onConfirm(parsed.data.reason);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível restaurar.");
      setPending(false);
      reasonField.current?.focus();
    }
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <Card className="mb-4 max-w-2xl border-destructive/40">
      <CardContent className="p-4">
        <form
          onSubmit={submit}
          onKeyDown={cancelOnEscape}
          noValidate
          aria-label="Restaurar o backup"
          className="space-y-3"
        >
          <p className="font-medium">Restaurar {what}</p>
          <p className="text-sm">
            <span className="font-medium">Tem certeza?</span>{" "}
            {backupAt
              ? `O sistema volta ao estado de ${backupAt}: os lançamentos feitos depois disso serão perdidos.`
              : "O sistema volta ao estado deste backup: os lançamentos feitos depois dele serão perdidos."}{" "}
            Antes, uma cópia de segurança do banco atual é salva neste PC. Depois, o sistema
            reinicia. Esc cancela.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="restore-reason">Motivo da restauração</Label>
            <Input
              id="restore-reason"
              ref={reasonField}
              autoComplete="off"
              maxLength={BACKUP_RESTORE_REASON_MAX}
              placeholder="Ex.: lançamentos apagados por engano"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Restaurando…" : "Restaurar backup"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
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
