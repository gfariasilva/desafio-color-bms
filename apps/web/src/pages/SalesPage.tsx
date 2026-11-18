import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  formatInstantTime,
  formatRatePercent,
  isCardFeeUsable,
  isCivilDate,
  MAX_INSTALLMENTS,
  needsCardFee,
  parseMoneyToCents,
  saleDateError,
  saleMachineError,
  SALE_TEXTS,
  type CardFee,
  type CardMachine,
  type CreateSaleInput,
  type PaymentMethod,
  type Sale,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
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

interface FormError {
  message: string;
  code?: string;
}

/**
 * Vendas (FR-01, FR-02): the keyboard-first sale form and the sales of the chosen day.
 *
 * Keyboard (NFR-05, CS-2): focus starts on Valor; Tab → Aba (digit or first letters) →
 * Tab → Forma (digit) → Enter saves. Maquininha and Parcelas are enabled only when the
 * payment method uses them. After saving, the form is cleared except for the date, and
 * focus returns to Valor for the next sale.
 */
export function SalesPage() {
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: QUERY_KEYS.today, queryFn: api.today });
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
  const valueField = useRef<HTMLInputElement>(null);

  // RN-15: the date starts as the server's today (never the browser clock).
  useEffect(() => {
    if (today.data)
      setForm((current) => (current.date ? current : { ...current, date: today.data }));
  }, [today.data]);

  const listDate = isCivilDate(form.date) ? form.date : null;
  const sales = useQuery({
    queryKey: [...QUERY_KEYS.sales, listDate],
    queryFn: () => api.sales.list(listDate as string),
    enabled: listDate !== null,
  });

  const tabList = tabs.data ?? [];
  const methodList = methods.data ?? [];
  const machineList = machines.data ?? [];
  const method = methodList.find((item) => item.id === form.paymentMethodId);
  const machineDisabled = !method || method.machineUsage === "not_applicable";
  const installmentsDisabled = !method?.allowsInstallments;
  const tabOrder = new Map(tabList.map((tab) => [tab.id, tab.order]));

  const save = useMutation({
    mutationFn: (input: CreateSaleInput) => api.sales.create(input),
    onSuccess: async (sale, input) => {
      setError(null);
      setSaved(`Venda de ${formatCents(sale.grossCents)} registrada.`);
      // FR-01: ready for the next sale, keeping the date.
      setForm(nextSale(input.date));
      valueField.current?.focus();
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.sales, sale.date] });
    },
    onError: (failure) => {
      setSaved(null);
      setError(
        failure instanceof ApiError
          ? { message: failure.message, code: failure.code }
          : { message: "Erro inesperado. Tente de novo." },
      );
    },
  });

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
    const grossCents = parseMoneyToCents(form.value);
    if (grossCents === null) return fail(SALE_TEXTS.invalidValue);
    if (form.saleCategoryId === null) return fail("Escolha a aba.");
    if (!method) return fail("Escolha a forma de pagamento.");
    const machineError = saleMachineError(method, form.cardMachineId);
    if (machineError) return fail(machineError);
    if (today.data && isCivilDate(form.date)) {
      const dateError = saleDateError(form.date, today.data);
      if (dateError) return fail(dateError);
    }

    const input: CreateSaleInput = {
      date: form.date,
      grossCents,
      saleCategoryId: form.saleCategoryId,
      paymentMethodId: method.id,
      cardMachineId: method.machineUsage === "not_applicable" ? null : form.cardMachineId,
      installments: method.allowsInstallments ? Number(form.installments) : null,
      note: form.note.trim() || null,
    };
    // The same schema as the server, so its pt-BR messages show before any request.
    const parsed = createSaleInputSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    setSaved(null); // the confirmation always refers to the last save
    save.mutate(input);
  }

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Registre as vendas do dia: valor → aba → forma → Enter."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form onSubmit={submit} noValidate className="space-y-4" aria-label="Nova venda">
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
                .filter((tab) => tab.active)
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
                .filter((item) => item.active)
                .map((item) => ({ value: item.id, label: item.name }))}
              value={form.paymentMethodId}
              onChange={chooseMethod}
            />

            <div className="flex flex-wrap items-end gap-3">
              <ChoiceGroup
                label="Maquininha"
                options={machineList
                  .filter((item) => item.active)
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
            </div>

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
        <h2 id="sales-day-title" className="mb-2 text-base font-semibold">
          {listDate ? `Vendas de ${formatCivilDate(listDate)}` : "Vendas"}
        </h2>
        <SalesTable sales={sales.data ?? []} tabOrder={tabOrder} loading={sales.isLoading} />
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

/** FR-01: the sales of the chosen day, with the day's totals (computed, never stored). */
function SalesTable({
  sales,
  tabOrder,
  loading,
}: {
  sales: readonly Sale[];
  tabOrder: ReadonlyMap<number, number>;
  loading: boolean;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (sales.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma venda neste dia. Registre a primeira com Enter.
      </p>
    );
  }
  const total = sales.reduce(
    (sum, sale) => ({
      gross: sum.gross + sale.grossCents,
      fee: sum.fee + sale.feeCents,
      net: sum.net + sale.netCents,
    }),
    { gross: 0, fee: 0, net: 0 },
  );
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hora</TableHead>
            <TableHead>Aba</TableHead>
            <TableHead>Forma</TableHead>
            <TableHead>Maquininha</TableHead>
            <TableHead className="text-right">Parc.</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Taxa (%)</TableHead>
            <TableHead className="text-right">Taxa</TableHead>
            <TableHead className="text-right">Líquido</TableHead>
            <TableHead>Observação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((sale) => (
            <TableRow key={sale.id}>
              <TableCell>{formatInstantTime(sale.createdAt)}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: categoryColor((tabOrder.get(sale.saleCategoryId) ?? 1) - 1),
                    }}
                  />
                  {sale.saleCategoryName}
                </span>
              </TableCell>
              <TableCell>{sale.paymentMethodName}</TableCell>
              <TableCell>{sale.cardMachineName ?? "—"}</TableCell>
              <TableCell className="text-right">
                {sale.installments === null ? "—" : `${sale.installments}x`}
              </TableCell>
              <TableCell className="text-right">{formatCents(sale.grossCents)}</TableCell>
              <TableCell className="text-right">
                {sale.feeRatePpm === 0 ? "—" : formatRatePercent(sale.feeRatePpm)}
              </TableCell>
              <TableCell className="text-right">{formatCents(sale.feeCents)}</TableCell>
              <TableCell className="text-right">{formatCents(sale.netCents)}</TableCell>
              <TableCell className="text-muted-foreground">{sale.note ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <tfoot className="border-t bg-muted/50 font-medium">
          <TableRow>
            <TableCell colSpan={5}>Total do dia</TableCell>
            <TableCell className="text-right">{formatCents(total.gross)}</TableCell>
            <TableCell />
            <TableCell className="text-right">{formatCents(total.fee)}</TableCell>
            <TableCell className="text-right">{formatCents(total.net)}</TableCell>
            <TableCell />
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}
