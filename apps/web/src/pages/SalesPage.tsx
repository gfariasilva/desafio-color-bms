import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  calculateSaleAmounts,
  CARD_FEE_MISSING_CODE,
  createSaleInputSchema,
  feeInstallments,
  findFeeInForce,
  formatCents,
  formatCivilDate,
  formatMoneyInput,
  formatRatePercent,
  isCardFeeUsable,
  isCivilDate,
  MAX_INSTALLMENTS,
  needsCardFee,
  parseMoneyToCents,
  parseMoneyText,
  saleDateError,
  saleMachineError,
  SALE_TEXTS,
  type CardFee,
  type CardMachine,
  type CreateSaleInput,
  type PaymentMethod,
  type Sale,
} from "@color-bms/core";
import { DaySalesView } from "@/components/sales/DaySalesView";
import { describeSale } from "@/components/sales/describe-sale";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, QUERY_KEYS } from "@/lib/api";
import { categoryColor } from "@/lib/category-colors";

/** What the owner types; turned into a CreateSaleInput on submit. */
interface FormState {
  date: string;
  value: string;
  saleCategoryId: number | null;
  paymentMethodId: number | null;
  cardMachineId: number | null;
  installments: string;
  note: string;
}

/** A fresh form for the next sale: everything cleared except the date (FR-01). */
function nextSale(date: string): FormState {
  return {
    date,
    value: "",
    saleCategoryId: null,
    paymentMethodId: null,
    cardMachineId: null,
    installments: "1",
    note: "",
  };
}

/** FR-03: the saved sale loaded into the form, to edit it. */
function fromSale(sale: Sale): FormState {
  return {
    date: sale.date,
    value: formatMoneyInput(sale.grossCents),
    saleCategoryId: sale.saleCategoryId,
    paymentMethodId: sale.paymentMethodId,
    cardMachineId: sale.cardMachineId,
    installments: String(sale.installments ?? 1),
    note: sale.note ?? "",
  };
}

interface FormError {
  message: string;
  code?: string;
}

/**
 * Vendas (FR-01, FR-02, FR-03, FR-05): the keyboard-first sale form and the chosen day per tab.
 *
 * Keyboard (NFR-05, CS-2): focus starts on Valor; Tab → Aba (digit or first letters) →
 * Tab → Forma (digit) → Enter saves. Maquininha and Parcelas are enabled only when the
 * payment method uses them. After saving, the form is cleared except for the date, and
 * focus returns to Valor for the next sale.
 *
 * FR-03: "Editar" on a row loads the sale into the same form (Salvar / Cancelar, Esc cancels);
 * "Excluir" asks for confirmation. On a closed day both only explain how to change it (RN-14).
 */
export function SalesPage() {
  const queryClient = useQueryClient();
  // RN-15: re-asked every minute, so a page left open overnight moves to the new day.
  const today = useQuery({
    queryKey: QUERY_KEYS.today,
    queryFn: api.today,
    refetchInterval: 60_000,
  });
  const tabs = useQuery({ queryKey: QUERY_KEYS.sale, queryFn: api.saleCategories.list });
  const methods = useQuery({
    queryKey: QUERY_KEYS.payment_method,
    queryFn: api.paymentMethods.list,
  });
  const machines = useQuery({ queryKey: QUERY_KEYS.card_machine, queryFn: api.cardMachines.list });
  const fees = useQuery({ queryKey: QUERY_KEYS.card_fees, queryFn: api.cardFees.list });

  const [form, setForm] = useState<FormState>(() => nextSale(""));
  const [error, setError] = useState<FormError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<Sale | null>(null);
  // FR-03: the new sale being typed when "Editar" was pressed, restored after the edit.
  const draft = useRef<FormState | null>(null);
  // Read by the RN-15 effect below, which must not move a sale being edited to a new day.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const valueField = useRef<HTMLInputElement>(null);

  // RN-15: the date starts as the server's today (never the browser clock). When the day
  // changes, a form still on the old "today" follows it; a date the owner chose is kept.
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
    queryKey: [...QUERY_KEYS.salesDay, listDate],
    queryFn: () => api.sales.day(listDate as string),
    enabled: listDate !== null,
  });

  const tabList = tabs.data ?? [];
  const methodList = methods.data ?? [];
  const machineList = machines.data ?? [];
  const method = methodList.find((item) => item.id === form.paymentMethodId);
  const machineDisabled = !method || method.machineUsage === "not_applicable";
  const installmentsDisabled = !method?.allowsInstallments;
  // FR-03: while editing, the sale may keep a tab, method or machine deactivated since.
  const offered = (item: { id: number; active: boolean }, currentId: number | null | undefined) =>
    item.active || item.id === currentId;

  function showFailure(failure: unknown) {
    setSaved(null);
    setError(
      failure instanceof ApiError
        ? { message: failure.message, code: failure.code }
        : { message: "Erro inesperado. Tente de novo." },
    );
  }

  /** The form after an edit ends: the new sale that was being typed, or an empty one. */
  function afterEdit(date: string): FormState {
    return draft.current ?? nextSale(date);
  }

  /** After a save or delete: show `next` in the form, focus on Valor, fresh totals. */
  async function done(message: string, next: FormState) {
    setError(null);
    setSaved(message);
    setEditing(null);
    draft.current = null;
    setForm(next);
    valueField.current?.focus();
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sales });
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CreateSaleInput; next: FormState }) =>
      id === null ? api.sales.create(input) : api.sales.update(id, input),
    // FR-01: ready for the next sale, keeping the date; after an edit, the draft is back.
    // `next` is decided when saving, so nothing done while the request runs changes it.
    onSuccess: (sale, { id, next }) =>
      done(
        id === null ? `Venda de ${formatCents(sale.grossCents)} registrada.` : "Venda alterada.",
        next,
      ),
    onError: showFailure,
  });

  const remove = useMutation({
    mutationFn: (sale: Sale) => api.sales.remove(sale.id),
    onSuccess: async (_, sale) => {
      // Deleting the sale being edited ends the edit; a new sale being typed is kept.
      if (editing?.id === sale.id) return done("Venda excluída.", afterEdit(sale.date));
      setError(null);
      setSaved("Venda excluída.");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sales });
    },
    onError: showFailure,
  });

  /** RN-14 / FR-03: a closed day cannot change; say how instead of opening the form. */
  function blockedByLock(): boolean {
    const lock = day.data?.lock;
    if (!lock) return false;
    setSaved(null);
    setError({ message: lock });
    return true;
  }

  function startEdit(sale: Sale) {
    if (blockedByLock()) return;
    setError(null);
    setSaved(null);
    if (!editing) draft.current = form;
    setEditing(sale);
    setForm(fromSale(sale));
    valueField.current?.focus();
  }

  function cancelEdit() {
    // While the edit is being saved, its result decides what the form shows next.
    if (!editing || save.isPending) return;
    setEditing(null);
    setError(null);
    setForm(afterEdit(editing.date));
    draft.current = null;
    valueField.current?.focus();
  }

  function confirmDelete(sale: Sale) {
    if (blockedByLock()) return;
    const question = `Excluir a venda de ${formatCents(sale.grossCents)} (${sale.saleCategoryName}, ${sale.paymentMethodName})? A exclusão fica registrada na auditoria.`;
    if (window.confirm(question)) remove.mutate(sale);
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

  function chooseMethod(id: number) {
    const chosen = methodList.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      paymentMethodId: id,
      // Fields that no longer apply are cleared, so the server never gets them (FR-01).
      cardMachineId: chosen?.machineUsage === "not_applicable" ? null : current.cardMachineId,
      installments: chosen?.allowsInstallments ? current.installments : "1",
    }));
  }

  function fail(message: string) {
    setSaved(null);
    setError({ message });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    // Well-formed text only; zero and the maximum are the schema's job (its messages).
    const grossCents = parseMoneyText(form.value);
    if (grossCents === null) return fail(SALE_TEXTS.invalidValue);

    // The same schema as the server, so its pt-BR messages show before any request
    // ("Escolha a aba.", "Escolha a forma de pagamento.", the maximum value…).
    const parsed = createSaleInputSchema.safeParse({
      date: form.date,
      grossCents,
      saleCategoryId: form.saleCategoryId ?? undefined,
      paymentMethodId: form.paymentMethodId ?? undefined,
      cardMachineId: machineDisabled ? null : form.cardMachineId,
      installments: method?.allowsInstallments ? Number(form.installments) : null,
      note: form.note,
    });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    if (!method) return fail(SALE_TEXTS.inactiveMethod);
    const machineError = saleMachineError(method, form.cardMachineId);
    if (machineError) return fail(machineError);
    if (today.data) {
      const dateError = saleDateError(parsed.data.date, today.data);
      if (dateError) return fail(dateError);
    }
    setSaved(null); // the confirmation always refers to the last save
    save.mutate(
      editing
        ? { id: editing.id, input: parsed.data, next: afterEdit(editing.date) }
        : { id: null, input: parsed.data, next: nextSale(parsed.data.date) },
    );
  }

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Registre as vendas do dia: valor → aba → forma → Enter."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form
            onSubmit={submit}
            onKeyDown={cancelOnEscape}
            noValidate
            className="space-y-4"
            aria-label={editing ? "Editar venda" : "Nova venda"}
          >
            {editing ? (
              <p className="text-sm font-medium">
                Editando a venda {describeSale(editing)} · Esc cancela
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40 space-y-1.5">
                <Label htmlFor="sale-date">Data</Label>
                <Input
                  id="sale-date"
                  type="date"
                  value={form.date}
                  max={today.data}
                  onChange={(event) => set("date", event.target.value)}
                />
              </div>
              <div className="w-40 space-y-1.5">
                <Label htmlFor="sale-value">Valor (R$)</Label>
                <Input
                  id="sale-value"
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
              <FeePreview
                value={form.value}
                date={form.date}
                method={method}
                machine={machineList.find((item) => item.id === form.cardMachineId)}
                installments={method?.allowsInstallments ? Number(form.installments) : null}
                fees={fees.data ?? []}
              />
            </div>

            <ChoiceGroup
              label="Aba"
              options={tabList
                .filter((tab) => offered(tab, editing?.saleCategoryId))
                .map((tab) => ({
                  value: tab.id,
                  label: tab.name,
                  color: categoryColor(tab.order - 1),
                }))}
              value={form.saleCategoryId}
              onChange={(id) => set("saleCategoryId", id)}
            />

            <ChoiceGroup
              label="Forma de pagamento"
              options={methodList
                .filter((item) => offered(item, editing?.paymentMethodId))
                .map((item) => ({ value: item.id, label: item.name }))}
              value={form.paymentMethodId}
              onChange={chooseMethod}
            />

            <div className="flex flex-wrap items-end gap-3">
              <ChoiceGroup
                label="Maquininha"
                options={machineList
                  .filter((item) => offered(item, editing?.cardMachineId))
                  .map((item) => ({ value: item.id, label: item.name }))}
                value={form.cardMachineId}
                onChange={(id) => set("cardMachineId", id)}
                disabled={machineDisabled}
              />
              <div className="w-24 space-y-1.5">
                <Label htmlFor="sale-installments">Parcelas</Label>
                <Input
                  id="sale-installments"
                  type="number"
                  min={1}
                  max={MAX_INSTALLMENTS}
                  value={form.installments}
                  disabled={installmentsDisabled}
                  // Typing "3" replaces the default 1 instead of making it "13".
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => set("installments", event.target.value)}
                />
              </div>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="sale-note">Observação</Label>
                <Input
                  id="sale-note"
                  autoComplete="off"
                  value={form.note}
                  onChange={(event) => set("note", event.target.value)}
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
                {error.message}
                {error.code === CARD_FEE_MISSING_CODE ? (
                  <>
                    {" "}
                    <Link to="/cadastros/taxas" className="font-medium text-primary underline">
                      Abrir tabela de taxas
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            <p role="status" className="min-h-5 text-sm text-muted-foreground">
              {saved}
            </p>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="sales-day-title">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="sales-day-title" className="text-base font-semibold">
            {listDate ? `Vendas de ${formatCivilDate(listDate)}` : "Vendas"}
          </h2>
          {day.data?.lock ? <Badge variant="secondary">Dia fechado</Badge> : null}
        </div>
        {day.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {day.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as vendas do dia. Recarregue a página.
          </p>
        ) : null}
        {day.data ? (
          <>
            {day.data.tabs.every((tab) => tab.sales.length === 0) ? (
              <p className="mb-2 text-sm text-muted-foreground">
                Nenhuma venda neste dia. Registre a primeira com Enter.
              </p>
            ) : null}
            <DaySalesView
              // FR-05: each date starts with its own open/collapsed tabs.
              key={day.data.date}
              day={day.data}
              editingId={editing?.id ?? null}
              busy={save.isPending || remove.isPending}
              onEdit={startEdit}
              onDelete={confirmDelete}
            />
          </>
        ) : null}
      </section>
    </>
  );
}

interface FeePreviewProps {
  value: string;
  date: string;
  method: PaymentMethod | undefined;
  machine: CardMachine | undefined;
  installments: number | null;
  fees: readonly CardFee[];
}

/**
 * FR-02: what the sale will store, before saving (RN-01 to RN-03, the same core rules as the
 * server). The server still decides: this is only a preview.
 */
function FeePreview({ value, date, method, machine, installments, fees }: FeePreviewProps) {
  const text = useMemo(() => {
    const grossCents = parseMoneyToCents(value);
    if (grossCents === null || !method || !isCivilDate(date)) return null;
    // While Parcelas is being typed ("" or 13), there is nothing to look up yet.
    if (
      installments !== null &&
      (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS)
    ) {
      return null;
    }
    if (!machine || !needsCardFee(method, machine.id)) {
      if (method.machineUsage === "required") return null;
      return `Sem taxa · Líquido ${formatCents(grossCents)}`;
    }
    const fee = isCardFeeUsable(machine, method)
      ? findFeeInForce(fees, {
          cardMachineId: machine.id,
          paymentMethodId: method.id,
          installments: feeInstallments(installments),
          date,
        })
      : undefined;
    if (!fee) return "Sem taxa cadastrada para esta combinação.";
    const { feeCents, netCents } = calculateSaleAmounts(grossCents, fee.ratePpm);
    return `Taxa ${formatRatePercent(fee.ratePpm)} · ${formatCents(feeCents)} · Líquido ${formatCents(netCents)}`;
  }, [value, date, method, machine, installments, fees]);

  return (
    <p data-testid="fee-preview" className="pb-2 text-sm tabular-nums text-muted-foreground">
      {text}
    </p>
  );
}
