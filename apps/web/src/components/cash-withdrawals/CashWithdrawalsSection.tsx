import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import {
  CASH_WITHDRAWAL_TEXTS,
  cashWithdrawalDateError,
  createCashWithdrawalInputSchema,
  formatCents,
  formatCivilDate,
  formatInstantTime,
  formatMoneyInput,
  parseMoneyText,
  type CashWithdrawal,
  type CivilDate,
  type CreateCashWithdrawalInput,
} from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError, QUERY_KEYS } from "@/lib/api";
import { describeEntry } from "@/lib/describe-entry";
import { cn } from "@/lib/utils";

interface FormState {
  value: string;
  note: string;
}

const EMPTY: FormState = { value: "", note: "" };

/** "das 10:05 de R$ 300,00": how a sangria is named in button labels and the edit banner. */
const describeWithdrawal = (withdrawal: CashWithdrawal) => describeEntry(withdrawal);

interface CashWithdrawalsSectionProps {
  /** The day chosen on the page (the expense form's Data); null while it is not a valid date. */
  date: CivilDate | null;
  /** The server's today (RN-15), once known. */
  today: CivilDate | undefined;
}

/**
 * Sangrias (FR-07): cash taken out of the till, e.g. to the bank. **Not an expense**: it only
 * reduces the day's expected cash (RN-07), never the expenses (RN-08) or the monthly balance
 * (RN-10). Lives on the Despesas page and uses the page's date.
 *
 * Keyboard (NFR-05): Valor da sangria → Tab → Observação → Enter saves; the form is cleared and
 * focus returns to Valor. "Editar" loads a sangria into the form (Esc cancels); "Excluir" asks
 * for confirmation. On a closed day both only explain how to change it (RN-14).
 */
export function CashWithdrawalsSection({ date, today }: CashWithdrawalsSectionProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<CashWithdrawal | null>(null);
  // The new sangria being typed when "Editar" was pressed, restored after the edit.
  const draft = useRef<FormState | null>(null);
  const valueField = useRef<HTMLInputElement>(null);

  const day = useQuery({
    queryKey: [...QUERY_KEYS.cashWithdrawalsDay, date],
    queryFn: () => api.cashWithdrawals.day(date as string),
    enabled: date !== null,
  });

  // A message about one day never stays on screen once the page shows another day.
  useEffect(() => {
    setError(null);
    setSaved(null);
  }, [date]);

  function fail(message: string) {
    setSaved(null);
    setError(message);
  }

  function showFailure(failure: unknown) {
    fail(failure instanceof ApiError ? failure.message : "Erro inesperado. Tente de novo.");
  }

  /** After a save or delete: clear the form (or restore the draft), focus Valor, fresh list. */
  async function done(message: string) {
    setError(null);
    setSaved(message);
    setEditing(null);
    setForm(draft.current ?? EMPTY);
    draft.current = null;
    valueField.current?.focus();
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cashWithdrawals });
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CreateCashWithdrawalInput }) =>
      id === null
        ? api.cashWithdrawals.create(input)
        : api.cashWithdrawals.update(id, { amountCents: input.amountCents, note: input.note }),
    onSuccess: (withdrawal, { id }) =>
      done(
        id === null
          ? `Sangria de ${formatCents(withdrawal.amountCents)} registrada.`
          : "Sangria alterada.",
      ),
    onError: showFailure,
  });

  const remove = useMutation({
    mutationFn: (withdrawal: CashWithdrawal) => api.cashWithdrawals.remove(withdrawal.id),
    onSuccess: async (_, withdrawal) => {
      if (editing?.id === withdrawal.id) return done("Sangria excluída.");
      setError(null);
      setSaved("Sangria excluída.");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cashWithdrawals });
    },
    onError: showFailure,
  });

  /** RN-14: a closed day cannot change; say how instead of opening the form. */
  function blockedByLock(): boolean {
    const lock = day.data?.lock;
    if (!lock) return false;
    fail(lock);
    return true;
  }

  function startEdit(withdrawal: CashWithdrawal) {
    if (blockedByLock()) return;
    setError(null);
    setSaved(null);
    if (!editing) draft.current = form;
    setEditing(withdrawal);
    setForm({ value: formatMoneyInput(withdrawal.amountCents), note: withdrawal.note ?? "" });
    valueField.current?.focus();
  }

  function cancelEdit() {
    if (!editing || save.isPending) return;
    setEditing(null);
    setError(null);
    setForm(draft.current ?? EMPTY);
    draft.current = null;
    valueField.current?.focus();
  }

  function confirmDelete(withdrawal: CashWithdrawal) {
    if (blockedByLock()) return;
    const question = `Excluir a sangria de ${formatCents(withdrawal.amountCents)}? A exclusão fica registrada na auditoria.`;
    if (window.confirm(question)) remove.mutate(withdrawal);
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      cancelEdit();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    // An edit keeps the sangria's own date; only a new sangria needs the page's date.
    const entryDate = editing?.date ?? date;
    if (entryDate === null) return fail("Escolha uma data válida no formulário de despesas.");
    const amountCents = parseMoneyText(form.value);
    if (amountCents === null) return fail(CASH_WITHDRAWAL_TEXTS.invalidValue);

    // The same schema as the server, so its pt-BR messages show before any request.
    const parsed = createCashWithdrawalInputSchema.safeParse({
      date: entryDate,
      amountCents,
      note: form.note,
    });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    if (today && !editing) {
      const dateError = cashWithdrawalDateError(parsed.data.date, today);
      if (dateError) return fail(dateError);
    }
    setSaved(null);
    save.mutate({ id: editing?.id ?? null, input: parsed.data });
  }

  const busy = save.isPending || remove.isPending;

  return (
    <section aria-labelledby="cash-withdrawals-title" className="mt-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 id="cash-withdrawals-title" className="text-base font-semibold">
          {date ? `Sangrias de ${formatCivilDate(date)}` : "Sangrias"}
        </h2>
        <Badge variant="outline">Não é despesa</Badge>
        {day.data?.lock ? <Badge variant="secondary">Dia fechado</Badge> : null}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Dinheiro retirado do caixa (ex.: depósito no banco). Reduz o dinheiro esperado no
        fechamento, mas não entra nas despesas nem no saldo do mês.
      </p>

      <Card className="mb-4">
        <CardContent className="p-4">
          <form
            onSubmit={submit}
            onKeyDown={cancelOnEscape}
            noValidate
            className="space-y-3"
            aria-label={editing ? "Editar sangria" : "Nova sangria"}
          >
            {editing ? (
              <p className="text-sm font-medium">
                Editando a sangria {describeWithdrawal(editing)} · Esc cancela
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40 space-y-1.5">
                <Label htmlFor="withdrawal-value">Valor da sangria (R$)</Label>
                <Input
                  id="withdrawal-value"
                  ref={valueField}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  className="text-right tabular-nums"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                />
              </div>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="withdrawal-note">Observação</Label>
                <Input
                  id="withdrawal-note"
                  autoComplete="off"
                  placeholder="ex.: depósito no banco"
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                />
              </div>
              <Button type="submit" disabled={save.isPending}>
                Registrar sangria
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={cancelEdit}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <p role="status" className="min-h-5 text-sm text-muted-foreground">
              {saved}
            </p>
          </form>
        </CardContent>
      </Card>

      {day.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {day.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as sangrias do dia. Recarregue a página.
        </p>
      ) : null}
      {day.data ? (
        day.data.withdrawals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma sangria neste dia.</p>
        ) : (
          <Card className="overflow-x-auto">
            <Table aria-label="Sangrias do dia">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Hora</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {day.data.withdrawals.map((withdrawal) => (
                  <TableRow
                    key={withdrawal.id}
                    className={cn(editing?.id === withdrawal.id && "bg-muted")}
                  >
                    <TableCell className="text-muted-foreground">
                      {formatInstantTime(withdrawal.createdAt)}
                    </TableCell>
                    <TableCell>{withdrawal.note ?? ""}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCents(withdrawal.amountCents)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Editar sangria ${describeWithdrawal(withdrawal)}`}
                          title="Editar"
                          disabled={busy}
                          onClick={() => startEdit(withdrawal)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Excluir sangria ${describeWithdrawal(withdrawal)}`}
                          title="Excluir"
                          disabled={busy}
                          onClick={() => confirmDelete(withdrawal)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot className="border-t bg-muted/30">
                <TableRow className="font-medium">
                  <TableCell colSpan={2}>Total de sangrias</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {formatCents(day.data.totalCents)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </tfoot>
            </Table>
          </Card>
        )
      ) : null}
    </section>
  );
}
