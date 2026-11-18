import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import {
  canHaveCardFee,
  cardFeeInputSchema,
  cardFeeOverlapMessage,
  FEE_STATUS_LABELS,
  feeStatus,
  findOverlappingFee,
  formatCivilDate,
  formatInstallmentRange,
  formatRateDecimal,
  formatRatePercent,
  MAX_INSTALLMENTS,
  parseRatePercent,
  todayCivilDate,
  type CardFee,
  type CardFeeInput,
  type CardMachine,
  type FeeStatus,
  type PaymentMethod,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, QUERY_KEYS } from "@/lib/api";
import { cn } from "@/lib/utils";

/** What the owner types; turned into a CardFeeInput on submit. */
interface FormState {
  cardMachineId: string;
  paymentMethodId: string;
  installmentsFrom: string;
  installmentsTo: string;
  rate: string;
  validFrom: string;
}

function emptyForm(): FormState {
  return {
    cardMachineId: "",
    paymentMethodId: "",
    installmentsFrom: "1",
    installmentsTo: "1",
    rate: "",
    validFrom: todayCivilDate(),
  };
}

const RATE_MESSAGE = "Informe a taxa em %, por exemplo 3,79 (até 4 casas decimais, de 0 a 100).";

const STATUS_BADGES: Record<FeeStatus, { variant: BadgeProps["variant"]; className?: string }> = {
  current: { variant: "success" },
  future: { variant: "secondary" },
  superseded: { variant: "outline", className: "text-muted-foreground" },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado. Tente de novo.";
}

/**
 * Cadastros › Tabela de taxas (FR-15): one row per card machine × payment method ×
 * installment range, with the rate and its "vigente desde". RN-01 picks the row for each
 * sale; a new rate is a new row with a later date, so older sales keep the old rate.
 *
 * Keyboard (NFR-05): Maquininha → Forma → Parcelas de/até → Taxa → Vigente desde, Enter
 * saves and focus returns to Maquininha. "Editar" loads a row into the same form; Esc cancels.
 */
export function CardFeesPage() {
  const queryClient = useQueryClient();
  const machines = useQuery({ queryKey: QUERY_KEYS.card_machine, queryFn: api.cardMachines.list });
  const methods = useQuery({
    queryKey: QUERY_KEYS.payment_method,
    queryFn: api.paymentMethods.list,
  });
  const fees = useQuery({ queryKey: QUERY_KEYS.card_fees, queryFn: api.cardFees.list });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<CardFee | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const firstField = useRef<HTMLSelectElement>(null);

  const machineList = machines.data ?? [];
  const methodList = methods.data ?? [];
  const feeList = fees.data ?? [];
  const machineById = new Map(machineList.map((machine) => [machine.id, machine]));
  const methodById = new Map(methodList.map((method) => [method.id, method]));
  const today = todayCivilDate();

  const selectedMethod = methodById.get(Number(form.paymentMethodId));
  // FR-01: only credit-like methods have installments; the others use the 1x range.
  const lockedToOne = selectedMethod !== undefined && !selectedMethod.allowsInstallments;

  // The form offers active machines and active methods that use a machine; when editing,
  // also the row's own machine and method, even if they were deactivated since.
  const machineOptions = machineList.filter(
    (machine) => machine.active || machine.id === editing?.cardMachineId,
  );
  const methodOptions = methodList.filter(
    (method) => (method.active && canHaveCardFee(method)) || method.id === editing?.paymentMethodId,
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.card_fees });

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CardFeeInput }) =>
      id === null ? api.cardFees.create(input) : api.cardFees.update(id, input),
    onSuccess: async () => {
      // Keep machine, method and date: the owner usually types several ranges in a row.
      setForm((current) => ({
        ...current,
        installmentsFrom: "1",
        installmentsTo: "1",
        rate: "",
      }));
      setEditing(null);
      setFormError(null);
      await refresh();
      firstField.current?.focus();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (fee: CardFee) => api.cardFees.remove(fee.id),
    onSuccess: async () => {
      setListError(null);
      await refresh();
      firstField.current?.focus();
    },
    onError: (error) => setListError(errorMessage(error)),
  });

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  /** "PagSeguro / Cartão de crédito / 2–6x desde 01/01/2026", for labels and messages. */
  function describe(fee: CardFee): string {
    const machine = machineById.get(fee.cardMachineId)?.name ?? "?";
    const method = methodById.get(fee.paymentMethodId)?.name ?? "?";
    const range = formatInstallmentRange(fee.installmentsFrom, fee.installmentsTo);
    return `${machine} / ${method} / ${range} desde ${formatCivilDate(fee.validFrom)}`;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.cardMachineId) return setFormError("Escolha a maquininha.");
    if (!form.paymentMethodId) return setFormError("Escolha a forma de pagamento.");
    const ratePpm = parseRatePercent(form.rate);
    if (ratePpm === null) return setFormError(RATE_MESSAGE);

    const parsed = cardFeeInputSchema.safeParse({
      cardMachineId: Number(form.cardMachineId),
      paymentMethodId: Number(form.paymentMethodId),
      installmentsFrom: lockedToOne ? 1 : Number(form.installmentsFrom),
      installmentsTo: lockedToOne ? 1 : Number(form.installmentsTo),
      ratePpm,
      validFrom: form.validFrom,
    });
    if (!parsed.success) {
      return setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const input = parsed.data;

    // FR-15: the same overlap rule as the server, checked here for a faster answer.
    const overlap = findOverlappingFee(feeList, input, editing?.id);
    if (overlap) {
      return setFormError(
        cardFeeOverlapMessage(
          machineById.get(input.cardMachineId)?.name ?? "?",
          methodById.get(input.paymentMethodId)?.name ?? "?",
          overlap,
        ),
      );
    }
    save.mutate({ id: editing?.id ?? null, input });
  }

  function startEdit(fee: CardFee) {
    setEditing(fee);
    setFormError(null);
    setForm({
      cardMachineId: String(fee.cardMachineId),
      paymentMethodId: String(fee.paymentMethodId),
      installmentsFrom: String(fee.installmentsFrom),
      installmentsTo: String(fee.installmentsTo),
      rate: formatRateDecimal(fee.ratePpm),
      validFrom: fee.validFrom,
    });
    firstField.current?.focus();
  }

  function cancelEdit() {
    setEditing(null);
    setFormError(null);
    setForm(emptyForm());
    firstField.current?.focus();
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      cancelEdit();
    }
  }

  function confirmDelete(fee: CardFee) {
    const question = `Excluir a taxa ${describe(fee)}? Vendas já registradas não mudam.`;
    if (window.confirm(question)) remove.mutate(fee);
  }

  // Sections: every active machine, plus inactive ones that still have rows.
  const sections = machineList.filter(
    (machine) => machine.active || feeList.some((fee) => fee.cardMachineId === machine.id),
  );
  const loading = machines.isPending || methods.isPending || fees.isPending;
  const loadError = machines.error ?? methods.error ?? fees.error;

  function renderSection(machine: CardMachine) {
    const rows = feeList.filter((fee) => fee.cardMachineId === machine.id);
    return (
      <section key={machine.id} className="grid gap-2">
        <h2 className={cn("text-base font-semibold", !machine.active && "text-muted-foreground")}>
          {machine.name}
          {!machine.active && <span className="sr-only"> (inativa)</span>}
        </h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Forma de pagamento</TableHead>
                  <TableHead>Parcelas</TableHead>
                  <TableHead className="text-right">Taxa</TableHead>
                  <TableHead>Vigente desde</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Nenhuma taxa para esta maquininha. Sem taxa, as vendas no cartão com ela ficam
                      bloqueadas.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((fee) => renderRow(fee))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    );
  }

  function renderRow(fee: CardFee) {
    const status = feeStatus(feeList, fee, today);
    const badge = STATUS_BADGES[status];
    const label = describe(fee);
    return (
      <TableRow
        key={fee.id}
        className={cn(
          status === "superseded" && "text-muted-foreground",
          editing?.id === fee.id && "bg-muted",
        )}
      >
        <TableCell>{methodById.get(fee.paymentMethodId)?.name ?? "?"}</TableCell>
        <TableCell>{formatInstallmentRange(fee.installmentsFrom, fee.installmentsTo)}</TableCell>
        <TableCell className="text-right">{formatRatePercent(fee.ratePpm)}</TableCell>
        <TableCell>{formatCivilDate(fee.validFrom)}</TableCell>
        <TableCell>
          <Badge variant={badge.variant} className={badge.className}>
            {FEE_STATUS_LABELS[status]}
          </Badge>
        </TableCell>
        <TableCell className="w-24">
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Editar ${label}`}
              title="Editar"
              onClick={() => startEdit(fee)}
            >
              <Pencil />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              aria-label={`Excluir ${label}`}
              title="Excluir"
              disabled={remove.isPending}
              onClick={() => confirmDelete(fee)}
            >
              <Trash2 />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      <PageHeader
        title="Tabela de taxas"
        description="A taxa de cada maquininha por forma de pagamento e parcelas. Para mudar uma taxa, cadastre uma nova linha com a data em que ela começa a valer: as vendas anteriores continuam com a taxa antiga."
      />
      <p className="-mt-3 mb-4 flex gap-4">
        <Link to="/cadastros" className="text-primary underline-offset-4 hover:underline">
          ← Cadastros
        </Link>
        <Link
          to="/cadastros/maquininhas"
          className="text-primary underline-offset-4 hover:underline"
        >
          Maquininhas
        </Link>
        <Link
          to="/cadastros/formas-pagamento"
          className="text-primary underline-offset-4 hover:underline"
        >
          Formas de pagamento
        </Link>
      </p>

      <div className="max-w-5xl">
        <form
          onSubmit={submit}
          onKeyDown={cancelOnEscape}
          className="mb-4 flex flex-wrap items-end gap-3"
          noValidate
          aria-label={editing ? "Editar taxa" : "Nova taxa"}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="fee-machine">Maquininha</Label>
            <NativeSelect
              id="fee-machine"
              ref={firstField}
              className="w-44"
              value={form.cardMachineId}
              onChange={(event) => set("cardMachineId", event.target.value)}
            >
              <option value="">Escolha…</option>
              {machineOptions.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fee-method">Forma de pagamento</Label>
            <NativeSelect
              id="fee-method"
              className="w-48"
              value={form.paymentMethodId}
              onChange={(event) => set("paymentMethodId", event.target.value)}
            >
              <option value="">Escolha…</option>
              {methodOptions.map((method: PaymentMethod) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fee-from">Parcelas de</Label>
            <Input
              id="fee-from"
              type="number"
              min={1}
              max={MAX_INSTALLMENTS}
              className="w-24"
              disabled={lockedToOne}
              value={lockedToOne ? "1" : form.installmentsFrom}
              onChange={(event) => set("installmentsFrom", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fee-to">Parcelas até</Label>
            <Input
              id="fee-to"
              type="number"
              min={1}
              max={MAX_INSTALLMENTS}
              className="w-24"
              disabled={lockedToOne}
              value={lockedToOne ? "1" : form.installmentsTo}
              onChange={(event) => set("installmentsTo", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fee-rate">Taxa (%)</Label>
            <Input
              id="fee-rate"
              className="w-28 text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="3,79"
              value={form.rate}
              onChange={(event) => set("rate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fee-valid-from">Vigente desde</Label>
            <Input
              id="fee-valid-from"
              type="date"
              className="w-40"
              value={form.validFrom}
              onChange={(event) => set("validFrom", event.target.value)}
            />
          </div>
          <Button type="submit" disabled={save.isPending}>
            {editing ? "Salvar" : "Adicionar"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              Cancelar
            </Button>
          )}
        </form>

        {formError && (
          <p role="alert" className="mb-4 text-destructive">
            {formError}
          </p>
        )}
        {listError && (
          <p role="alert" className="mb-4 text-destructive">
            {listError}
          </p>
        )}
        {loadError && (
          <p role="alert" className="text-destructive">
            Não foi possível carregar a tabela de taxas: {loadError.message}
          </p>
        )}
        {loading && !loadError && <p className="text-muted-foreground">Carregando…</p>}

        {!loading && !loadError && (
          <div className="grid gap-5">
            {sections.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhuma maquininha ativa. Cadastre uma em Maquininhas.
              </p>
            ) : (
              sections.map(renderSection)
            )}
          </div>
        )}

        <p className="mt-3 text-muted-foreground">
          Em vigor: a taxa usada hoje. Futura: começa a valer na data indicada. Substituída: uma
          taxa mais nova já vale para todas as parcelas da faixa. Faixas de parcelas com a mesma
          data não podem se sobrepor.
        </p>
      </div>
    </>
  );
}
