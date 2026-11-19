import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  createOneOffFixedExpenseInputSchema,
  EXPENSE_PAYMENT_MEANS_LABELS,
  EXPENSE_STATUS_LABELS,
  FIXED_EXPENSE_GROUP_LABELS,
  FIXED_EXPENSE_GROUPS,
  fixedExpenseInstallmentLabel,
  formatCents,
  formatCivilDate,
  formatYearMonthLong,
  isYearMonth,
  parseMoneyText,
  type ExpenseStatus,
  type FixedExpense,
  type FixedExpenseGroup,
  type PayFixedExpenseInput,
} from "@color-bms/core";
import { ContaConversionPanel } from "@/components/fixed-expenses/ContaConversionPanel";
import { PayFixedExpenseForm } from "@/components/fixed-expenses/PayFixedExpenseForm";
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

/** What the owner types in "Nova conta avulsa". */
interface FormState {
  description: string;
  group: FixedExpenseGroup;
  dueDate: string;
  expectedAmount: string;
}

function emptyForm(group: FixedExpenseGroup = "general"): FormState {
  return { description: "", group, dueDate: "", expectedAmount: "" };
}

const AMOUNT_MESSAGE = "Informe o valor previsto, por exemplo 200,00, ou deixe em branco.";

/** Design system: green for paid, muted for dismissed, neutral for pending. */
const STATUS_VARIANTS: Record<ExpenseStatus, BadgeProps["variant"]> = {
  pending: "secondary",
  paid: "success",
  dismissed: "outline",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado. Tente de novo.";
}

/**
 * Despesas fixas › Contas do mês (FR-11): the month's bills, generated from the templates on
 * the first day the system is opened in the month, plus one-off bills the owner adds.
 * FR-12 / FR-13: each pending bill can be paid ("Pagar" opens a compact card above the list)
 * or dismissed; a payment can be undone and a dismissal reactivated while the period is open.
 * #13: the pilot's "CONTA:" sangrias are converted here (`ContaConversionPanel`).
 *
 * Keyboard (NFR-05): Conta → Grupo → Vencimento → Valor previsto; Enter adds and focus
 * returns to Conta. "Mês anterior"/"Próximo mês" move between months (never into the future).
 * The month is in the address (`?mes=2026-10`), so a link can open a given month.
 */
export function FixedExpensesMonthPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("mes");
  // Without ?mes=, the server answers with the current month (its clock, ADR 0002).
  const requestedMonth = requested && isYearMonth(requested) ? requested : undefined;

  const monthQuery = useQuery({
    queryKey: [...QUERY_KEYS.fixedExpensesMonth, requestedMonth ?? "current"],
    queryFn: () => api.fixedExpenses.month(requestedMonth ?? ""),
  });
  const data = monthQuery.data;
  const today = useQuery({ queryKey: QUERY_KEYS.today, queryFn: api.today });

  /** FR-12: the bill being paid in the card above the list, if any. */
  const [paying, setPaying] = useState<FixedExpense | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  /** The row buttons, to return focus to "Pagar" when the card is cancelled. */
  const rowButtons = useRef(new Map<number, HTMLButtonElement | null>());

  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: api.fixedExpenses.createOneOff,
    onSuccess: async (_created, input) => {
      setSaved(`Conta avulsa ${input.description} adicionada.`);
      setFormError(null);
      // Keep the group: the owner may add several bills of the same group in a row.
      setForm(emptyForm(input.group));
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fixedExpenses });
      firstField.current?.focus();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  async function refreshAfterPayment() {
    // A payment or undo also changes the day's closing (RN-07) and the CONTA: candidates.
    await Promise.all(
      [QUERY_KEYS.fixedExpenses, QUERY_KEYS.cashClosing].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  }

  const pay = useMutation({
    mutationFn: ({ id, input }: { id: number; input: PayFixedExpenseInput }) =>
      api.fixedExpenses.pay(id, input),
    onSuccess: async (paid) => {
      setPaying(null);
      setPayError(null);
      setFormError(null);
      const installment = fixedExpenseInstallmentLabel(paid);
      setSaved(
        `${paid.label} paga: ${formatCents(paid.amountCents ?? 0)} em ${formatCivilDate(paid.paymentDate ?? "")}${installment ? ` (${installment})` : ""}.`,
      );
      await refreshAfterPayment();
      firstField.current?.focus();
    },
    onError: (error) => setPayError(errorMessage(error)),
  });

  const changeStatus = useMutation({
    mutationFn: ({ expense, action }: { expense: FixedExpense; action: "dismiss" | "undo" }) =>
      action === "dismiss"
        ? api.fixedExpenses.dismiss(expense.id)
        : api.fixedExpenses.undo(expense.id),
    onSuccess: async (changed, { expense }) => {
      setFormError(null);
      // A bill that is no longer pending cannot stay in the pay card.
      setPaying((current) => (current?.id === changed.id ? null : current));
      setSaved(
        changed.status === "dismissed"
          ? `${changed.label} dispensada.`
          : expense.status === "paid"
            ? `Pagamento de ${changed.label} desfeito.`
            : `${changed.label} reativada.`,
      );
      await refreshAfterPayment();
    },
    onError: (error) => {
      setSaved(null);
      setFormError(errorMessage(error));
    },
  });

  function startPaying(expense: FixedExpense) {
    setSaved(null);
    setPayError(null);
    setPaying(expense);
  }

  function cancelPaying() {
    const id = paying?.id;
    setPaying(null);
    setPayError(null);
    if (id !== undefined) rowButtons.current.get(id)?.focus();
  }

  function confirmDismiss(expense: FixedExpense) {
    const question = `Dispensar ${expense.label} de ${formatYearMonthLong(expense.referenceMonth)}? Ela não se aplica neste mês: sai dos totais e dos alertas. A ação fica registrada na auditoria.`;
    if (window.confirm(question)) changeStatus.mutate({ expense, action: "dismiss" });
  }

  function confirmUndo(expense: FixedExpense) {
    const question =
      expense.status === "paid"
        ? `Desfazer o pagamento de ${expense.label} (${formatCents(expense.amountCents ?? 0)} em ${formatCivilDate(expense.paymentDate ?? "")})? A conta volta a pendente.`
        : `Reativar ${expense.label}? A conta volta a pendente.`;
    if (window.confirm(question)) changeStatus.mutate({ expense, action: "undo" });
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function goToMonth(month: string) {
    setSaved(null);
    setFormError(null);
    // The pay card belongs to the month on screen.
    setPaying(null);
    setSearchParams({ mes: month });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(null);
    if (!data || data.lock) return;

    const amountText = form.expectedAmount.trim();
    const amountCents = amountText === "" ? null : parseMoneyText(amountText);

    // The same schema as the server, so the messages are the same (FR-11).
    const parsed = createOneOffFixedExpenseInputSchema.safeParse({
      referenceMonth: data.month,
      description: form.description,
      group: form.group,
      dueDate: form.dueDate,
      expectedAmountCents: amountCents,
    });
    // Valor previsto is the last field, so its "not a number" message comes last.
    if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    if (amountText !== "" && amountCents === null) return setFormError(AMOUNT_MESSAGE);
    create.mutate(parsed.data);
  }

  function renderDueDate(expense: FixedExpense) {
    if (expense.dueDate) return formatCivilDate(expense.dueDate);
    return (
      // One line, so the table stays dense (design system).
      <span className="flex items-center gap-2 whitespace-nowrap">
        <Badge variant="outline">Sem vencimento</Badge>
        {!expense.oneOff && (
          <Link
            to="/despesas-fixas/modelos"
            className="text-primary underline-offset-4 hover:underline"
            aria-label={`Preencher o vencimento de ${expense.label} no modelo`}
          >
            Preencher
          </Link>
        )}
      </span>
    );
  }

  /** FR-12: what was paid, when and how; "do caixa" when it left the till (RN-07). */
  function renderPayment(expense: FixedExpense) {
    if (expense.status !== "paid" || expense.paymentDate === null) return "—";
    const means = expense.paymentMeans ? EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans] : "";
    return (
      <span className="whitespace-nowrap">
        <span className="tabular-nums">{formatCents(expense.amountCents ?? 0)}</span>
        <span className="text-muted-foreground">
          {" "}
          · {formatCivilDate(expense.paymentDate)} · {means}
          {expense.paidFromTill ? " do caixa" : ""}
        </span>
      </span>
    );
  }

  function renderActions(expense: FixedExpense) {
    const busy = changeStatus.isPending || pay.isPending;
    if (expense.status === "pending") {
      return (
        <span className="flex justify-end gap-1">
          <Button
            ref={(button) => {
              rowButtons.current.set(expense.id, button);
            }}
            size="sm"
            variant="outline"
            aria-label={`Pagar ${expense.label}`}
            disabled={busy || !today.data}
            onClick={() => startPaying(expense)}
          >
            Pagar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Dispensar ${expense.label}`}
            disabled={busy}
            onClick={() => confirmDismiss(expense)}
          >
            Dispensar
          </Button>
        </span>
      );
    }
    const label = expense.status === "paid" ? "Desfazer" : "Reativar";
    return (
      <span className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          aria-label={
            expense.status === "paid"
              ? `Desfazer o pagamento de ${expense.label}`
              : `Reativar ${expense.label}`
          }
          disabled={busy}
          onClick={() => confirmUndo(expense)}
        >
          {label}
        </Button>
      </span>
    );
  }

  function renderRow(expense: FixedExpense) {
    const installment = fixedExpenseInstallmentLabel(expense);
    return (
      <TableRow
        key={expense.id}
        className={cn(expense.status === "dismissed" && "text-muted-foreground")}
      >
        <TableCell className="w-48">{renderDueDate(expense)}</TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-2">
            {expense.label}
            {installment && <span className="text-muted-foreground">{installment}</span>}
            {expense.oneOff && <Badge variant="outline">Avulsa</Badge>}
          </span>
        </TableCell>
        <TableCell className="w-36 whitespace-nowrap text-right">
          {expense.expectedAmountCents === null ? "—" : formatCents(expense.expectedAmountCents)}
        </TableCell>
        <TableCell className="w-28">
          <Badge variant={STATUS_VARIANTS[expense.status]}>
            {EXPENSE_STATUS_LABELS[expense.status]}
          </Badge>
        </TableCell>
        <TableCell>{renderPayment(expense)}</TableCell>
        <TableCell className="w-44">{renderActions(expense)}</TableCell>
      </TableRow>
    );
  }

  function renderGroup(group: FixedExpenseGroup, list: FixedExpense[]) {
    const rows = list.filter((expense) => expense.group === group);
    const headingId = `fixed-month-group-${group}`;
    return (
      <section key={group} aria-labelledby={headingId} className="grid gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {FIXED_EXPENSE_GROUP_LABELS[group]}
        </h2>
        <Card>
          <CardContent className="p-0">
            <Table aria-labelledby={headingId}>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Valor previsto</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Nenhuma conta neste grupo.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map(renderRow)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    );
  }

  const month = data?.month ?? requestedMonth;
  const locked = Boolean(data?.lock);

  return (
    <>
      <PageHeader
        title={month ? `Contas de ${formatYearMonthLong(month)}` : "Contas do mês"}
        description="As contas de todo mês são criadas a partir dos modelos no primeiro dia em que o sistema é aberto no mês, como pendentes. Adicione aqui as contas avulsas do mês."
      />
      <p className="-mt-3 mb-4 flex flex-wrap gap-4">
        <Link to="/despesas-fixas" className="text-primary underline-offset-4 hover:underline">
          ← Despesas fixas
        </Link>
        <Link
          to="/despesas-fixas/modelos"
          className="text-primary underline-offset-4 hover:underline"
        >
          Modelos
        </Link>
      </p>

      <div className="max-w-6xl">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Mês anterior"
            title="Mês anterior"
            disabled={!data}
            onClick={() => data && goToMonth(addMonths(data.month, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Próximo mês"
            title="Próximo mês"
            disabled={!data || data.month >= data.currentMonth}
            onClick={() => data && goToMonth(addMonths(data.month, 1))}
          >
            <ChevronRight />
          </Button>
          {data && data.month !== data.currentMonth && (
            <Button variant="ghost" size="sm" onClick={() => goToMonth(data.currentMonth)}>
              Ir para o mês atual
            </Button>
          )}
        </div>

        <form
          onSubmit={submit}
          className="mb-2 flex flex-wrap items-end gap-3"
          noValidate
          aria-label="Nova conta avulsa"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="one-off-name">Conta</Label>
            <Input
              id="one-off-name"
              ref={firstField}
              // Data entry starts here (design system: focus on the first field).
              autoFocus
              className="w-56"
              autoComplete="off"
              disabled={locked}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="one-off-group">Grupo</Label>
            <NativeSelect
              id="one-off-group"
              className="w-40"
              disabled={locked}
              value={form.group}
              onChange={(event) => set("group", event.target.value as FixedExpenseGroup)}
            >
              {FIXED_EXPENSE_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {FIXED_EXPENSE_GROUP_LABELS[group]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="one-off-due-date">Vencimento</Label>
            <Input
              id="one-off-due-date"
              type="date"
              className="w-40"
              disabled={locked}
              value={form.dueDate}
              onChange={(event) => set("dueDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="one-off-amount">Valor previsto (R$)</Label>
            <Input
              id="one-off-amount"
              className="w-32 text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="opcional"
              disabled={locked}
              value={form.expectedAmount}
              onChange={(event) => set("expectedAmount", event.target.value)}
            />
          </div>
          <Button type="submit" disabled={locked || create.isPending}>
            Adicionar
          </Button>
        </form>
        <p className="mb-4 text-muted-foreground">
          {data?.lock ??
            "Conta avulsa: uma conta que não se repete todo mês. Ela entra no mês mostrado acima."}
        </p>

        {formError && (
          <p role="alert" className="mb-4 text-destructive">
            {formError}
          </p>
        )}
        {saved && !formError && (
          <p role="status" className="mb-4 text-muted-foreground">
            {saved}
          </p>
        )}
        {monthQuery.error && (
          <p role="alert" className="text-destructive">
            Não foi possível carregar as contas do mês: {monthQuery.error.message}
          </p>
        )}
        {monthQuery.isPending && <p className="text-muted-foreground">Carregando…</p>}

        <ContaConversionPanel
          onConverted={(text) => {
            setFormError(null);
            setSaved(text);
          }}
        />

        {paying && today.data && (
          <PayFixedExpenseForm
            key={paying.id}
            expense={paying}
            today={today.data}
            pending={pay.isPending}
            serverError={payError}
            onSubmit={(input) => pay.mutate({ id: paying.id, input })}
            onCancel={cancelPaying}
          />
        )}

        {data && (
          <>
            {!data.generated && (
              <p className="mb-4 rounded-md bg-muted px-3 py-2">
                As contas deste mês não foram geradas: o sistema ainda não estava em uso.
              </p>
            )}
            <div className="grid gap-5">
              {FIXED_EXPENSE_GROUPS.map((group) => renderGroup(group, data.expenses))}
            </div>
            <p className="mt-3 text-muted-foreground">
              Total previsto do mês (sem as dispensadas): {formatCents(data.expectedTotalCents)}
            </p>
            <p className="text-muted-foreground">
              Pago no mês (pela data do pagamento, inclusive contas de outros meses):{" "}
              <span className="font-medium text-foreground">
                {formatCents(data.paidTotalCents)}
              </span>
            </p>
          </>
        )}
      </div>
    </>
  );
}
