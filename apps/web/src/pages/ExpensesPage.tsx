import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createExpenseInputSchema,
  EXPENSE_CATEGORY_GROUP_LABELS,
  EXPENSE_CATEGORY_GROUPS,
  EXPENSE_PAYMENT_MEANS,
  EXPENSE_PAYMENT_MEANS_LABELS,
  EXPENSE_TEXTS,
  expenseDateError,
  formatCents,
  formatCivilDate,
  formatMoneyInput,
  formatYearMonth,
  isCivilDate,
  monthOf,
  parseMoneyText,
  type CreateExpenseInput,
  type Expense,
  type ExpensePaymentMeans,
} from "@color-bms/core";
import { CashWithdrawalsSection } from "@/components/cash-withdrawals/CashWithdrawalsSection";
import { DayExpensesTable } from "@/components/expenses/DayExpensesTable";
import { describeExpense } from "@/components/expenses/describe-expense";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api, ApiError, QUERY_KEYS } from "@/lib/api";

/** What the owner types; turned into a CreateExpenseInput on submit. */
interface FormState {
  date: string;
  value: string;
  /** The category id as the <select> holds it; "" while none is chosen. */
  categoryId: string;
  means: ExpensePaymentMeans | null;
  /** FR-06: only used with Dinheiro. */
  paidFromTill: boolean;
  description: string;
}

/** A fresh form for the next expense: everything cleared except the date (as FR-01). */
function nextExpense(date: string): FormState {
  return { date, value: "", categoryId: "", means: null, paidFromTill: true, description: "" };
}

/** FR-06 (as FR-03): the saved expense loaded into the form, to edit it. */
function fromExpense(expense: Expense): FormState {
  return {
    date: expense.paymentDate,
    value: formatMoneyInput(expense.amountCents),
    categoryId: String(expense.expenseCategoryId),
    means: expense.paymentMeans,
    paidFromTill: expense.paidFromTill,
    description: expense.description ?? "",
  };
}

/** The ChoiceGroup works with numbers: means n of A-14 is option n (1-based). */
const MEANS_OPTIONS = EXPENSE_PAYMENT_MEANS.map((means, index) => ({
  value: index + 1,
  label: EXPENSE_PAYMENT_MEANS_LABELS[means],
}));

/**
 * Despesas (FR-06): general expenses, "saídas diárias", and the chosen day's list; below them,
 * the day's sangrias (FR-07, `CashWithdrawalsSection`), which use the same date.
 *
 * Keyboard (NFR-05): focus starts on Valor; Tab → Categoria (type the first letters) →
 * Tab → Meio de pagamento (digit 1–5) → Enter saves. "Pago com dinheiro do caixa" is enabled
 * (and checked by default) only for Dinheiro. After saving, the form is cleared except for
 * the date, and focus returns to Valor.
 *
 * "Editar" loads an expense into the same form (Salvar / Cancelar, Esc cancels); "Excluir" asks
 * for confirmation. On a closed day both only explain how to change it (RN-14).
 */
export function ExpensesPage() {
  const queryClient = useQueryClient();
  // RN-15: re-asked every minute, so a page left open overnight moves to the new day.
  const today = useQuery({
    queryKey: QUERY_KEYS.today,
    queryFn: api.today,
    refetchInterval: 60_000,
  });
  const categories = useQuery({
    queryKey: QUERY_KEYS.expense,
    queryFn: api.expenseCategories.list,
  });

  const [form, setForm] = useState<FormState>(() => nextExpense(""));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  // The new expense being typed when "Editar" was pressed, restored after the edit.
  const draft = useRef<FormState | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const valueField = useRef<HTMLInputElement>(null);

  // RN-15: the date starts as the server's today. When the day changes, a form still on the
  // old "today" follows it; a date the owner chose is kept.
  const previousToday = useRef<string | null>(null);
  useEffect(() => {
    const newToday = today.data;
    if (!newToday) return;
    const oldToday = previousToday.current;
    previousToday.current = newToday;
    setForm((current) =>
      !editingRef.current && (!current.date || current.date === oldToday)
        ? { ...current, date: newToday }
        : current,
    );
  }, [today.data]);

  const listDate = isCivilDate(form.date) ? form.date : null;
  const day = useQuery({
    queryKey: [...QUERY_KEYS.expensesDay, listDate],
    queryFn: () => api.expenses.day(listDate as string),
    enabled: listDate !== null,
  });

  // While editing, the expense may keep a category deactivated since (as FR-03).
  const categoryList = (categories.data ?? []).filter(
    (category) => category.active || category.id === editing?.expenseCategoryId,
  );
  const isCash = form.means === "cash";

  function fail(message: string) {
    setSaved(null);
    setError(message);
  }

  function showFailure(failure: unknown) {
    fail(failure instanceof ApiError ? failure.message : "Erro inesperado. Tente de novo.");
  }

  function afterEdit(date: string): FormState {
    return draft.current ?? nextExpense(date);
  }

  /** After a save or delete: show `next` in the form, focus on Valor, fresh totals. */
  async function done(message: string, next: FormState) {
    setError(null);
    setSaved(message);
    setEditing(null);
    draft.current = null;
    setForm(next);
    valueField.current?.focus();
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenses });
  }

  const save = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number | null;
      input: CreateExpenseInput;
      next: FormState;
    }) => (id === null ? api.expenses.create(input) : api.expenses.update(id, input)),
    onSuccess: (expense, { id, next }) =>
      done(
        id === null
          ? `Despesa de ${formatCents(expense.amountCents)} registrada.`
          : "Despesa alterada.",
        next,
      ),
    onError: showFailure,
  });

  const remove = useMutation({
    mutationFn: (expense: Expense) => api.expenses.remove(expense.id),
    onSuccess: async (_, expense) => {
      if (editing?.id === expense.id) {
        return done("Despesa excluída.", afterEdit(expense.paymentDate));
      }
      setError(null);
      setSaved("Despesa excluída.");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenses });
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

  function startEdit(expense: Expense) {
    if (blockedByLock()) return;
    setError(null);
    setSaved(null);
    if (!editing) draft.current = form;
    setEditing(expense);
    setForm(fromExpense(expense));
    valueField.current?.focus();
  }

  function cancelEdit() {
    if (!editing || save.isPending) return;
    setEditing(null);
    setError(null);
    setForm(afterEdit(editing.paymentDate));
    draft.current = null;
    valueField.current?.focus();
  }

  function confirmDelete(expense: Expense) {
    if (blockedByLock()) return;
    const question = `Excluir a despesa de ${formatCents(expense.amountCents)} (${expense.expenseCategoryName}, ${EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans]})? A exclusão fica registrada na auditoria.`;
    if (window.confirm(question)) remove.mutate(expense);
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      cancelEdit();
    }
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function chooseMeans(option: number) {
    const means = EXPENSE_PAYMENT_MEANS[option - 1] ?? null;
    setForm((current) => ({
      ...current,
      means,
      // FR-06: Dinheiro is paid from the till by default; picking it again keeps the choice.
      paidFromTill: means === "cash" && current.means === "cash" ? current.paidFromTill : true,
    }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    // Well-formed text only; zero and the maximum are the schema's job (its messages).
    const amountCents = parseMoneyText(form.value);
    if (amountCents === null) return fail(EXPENSE_TEXTS.invalidValue);

    // The same schema as the server, so its pt-BR messages show before any request.
    const parsed = createExpenseInputSchema.safeParse({
      paymentDate: form.date,
      amountCents,
      expenseCategoryId: form.categoryId ? Number(form.categoryId) : undefined,
      paymentMeans: form.means ?? undefined,
      paidFromTill: isCash ? form.paidFromTill : false,
      description: form.description,
    });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    if (today.data) {
      const dateError = expenseDateError(parsed.data.paymentDate, today.data);
      if (dateError) return fail(dateError);
    }
    setSaved(null);
    save.mutate(
      editing
        ? { id: editing.id, input: parsed.data, next: afterEdit(editing.paymentDate) }
        : { id: null, input: parsed.data, next: nextExpense(parsed.data.paymentDate) },
    );
  }

  const meansValue = form.means ? EXPENSE_PAYMENT_MEANS.indexOf(form.means) + 1 : null;

  return (
    <>
      <PageHeader
        title="Despesas e sangrias"
        description="Saídas diárias: valor → categoria → meio de pagamento → Enter. Sangrias abaixo."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form
            onSubmit={submit}
            onKeyDown={cancelOnEscape}
            noValidate
            className="space-y-4"
            aria-label={editing ? "Editar despesa" : "Nova despesa"}
          >
            {editing ? (
              <p className="text-sm font-medium">
                Editando a despesa {describeExpense(editing)} · Esc cancela
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40 space-y-1.5">
                <Label htmlFor="expense-date">Data</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={form.date}
                  max={today.data}
                  onChange={(event) => set("date", event.target.value)}
                />
              </div>
              <div className="w-40 space-y-1.5">
                <Label htmlFor="expense-value">Valor (R$)</Label>
                <Input
                  id="expense-value"
                  ref={valueField}
                  autoFocus
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  className="text-right tabular-nums"
                  value={form.value}
                  onChange={(event) => set("value", event.target.value)}
                />
              </div>
              <div className="w-64 space-y-1.5">
                <Label htmlFor="expense-category">Categoria</Label>
                <NativeSelect
                  id="expense-category"
                  value={form.categoryId}
                  onChange={(event) => set("categoryId", event.target.value)}
                >
                  <option value="">Escolha…</option>
                  {EXPENSE_CATEGORY_GROUPS.map((group) => {
                    const ofGroup = categoryList.filter((category) => category.group === group);
                    return ofGroup.length ? (
                      <optgroup key={group} label={EXPENSE_CATEGORY_GROUP_LABELS[group]}>
                        {ofGroup.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </NativeSelect>
              </div>
            </div>

            <ChoiceGroup
              label="Meio de pagamento"
              options={MEANS_OPTIONS}
              value={meansValue}
              onChange={chooseMeans}
            />

            <div className="flex flex-wrap items-end gap-3">
              <label
                htmlFor="expense-from-till"
                className="flex h-9 items-center gap-2 text-sm font-medium has-[:disabled]:opacity-50"
              >
                <input
                  id="expense-from-till"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  checked={isCash && form.paidFromTill}
                  disabled={!isCash}
                  onChange={(event) => set("paidFromTill", event.target.checked)}
                  onKeyDown={(event) => {
                    // Enter submits from every field (design system), checkboxes included.
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
                />
                Pago com dinheiro do caixa
              </label>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="expense-description">Descrição</Label>
                <Input
                  id="expense-description"
                  autoComplete="off"
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                />
              </div>
              <Button type="submit" disabled={save.isPending}>
                Salvar
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

            {today.isError && !today.data ? (
              <p role="alert" className="text-sm text-destructive">
                Não foi possível obter a data de hoje do servidor. Recarregue a página.
              </p>
            ) : null}
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

      <section aria-labelledby="expenses-day-title">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="expenses-day-title" className="text-base font-semibold">
            {listDate ? `Saídas de ${formatCivilDate(listDate)}` : "Saídas"}
          </h2>
          {day.data?.lock ? <Badge variant="secondary">Dia fechado</Badge> : null}
        </div>
        {day.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {day.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as despesas do dia. Recarregue a página.
          </p>
        ) : null}
        {day.data ? (
          <>
            {day.data.expenses.length === 0 ? (
              <p className="mb-2 text-sm text-muted-foreground">
                Nenhuma despesa neste dia. Registre a primeira com Enter.
              </p>
            ) : (
              <DayExpensesTable
                day={day.data}
                editingId={editing?.id ?? null}
                busy={save.isPending || remove.isPending}
                onEdit={startEdit}
                onDelete={confirmDelete}
              />
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Despesas gerais do mês {formatYearMonth(monthOf(day.data.date))}:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatCents(day.data.monthGeneralTotalCents)}
              </span>
            </p>
          </>
        ) : null}
      </section>

      <CashWithdrawalsSection date={listDate} today={today.data} />
    </>
  );
}
