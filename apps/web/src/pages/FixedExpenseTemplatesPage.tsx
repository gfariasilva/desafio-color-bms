import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import {
  categoryNameKey,
  createFixedExpenseTemplateInputSchema,
  FIXED_EXPENSE_GROUP_LABELS,
  FIXED_EXPENSE_GROUPS,
  FIXED_EXPENSE_TEMPLATE_TEXTS,
  fixedExpenseTemplateLabel,
  fixedExpenseTemplateNameKey,
  formatCents,
  formatMoneyInput,
  MAX_LOAN_INSTALLMENTS,
  moveCategory,
  parseMoneyText,
  type CreateFixedExpenseTemplateInput,
  type FixedExpenseGroup,
  type FixedExpenseTemplate,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
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

/** What the owner types; turned into a template input on submit. */
interface FormState {
  name: string;
  group: FixedExpenseGroup;
  subgroup: string;
  dueDay: string;
  expectedAmount: string;
  isLoan: boolean;
  installmentsTotal: string;
  installmentsRemaining: string;
}

function emptyForm(group: FixedExpenseGroup = "general"): FormState {
  return {
    name: "",
    group,
    subgroup: "",
    dueDay: "",
    expectedAmount: "",
    isLoan: false,
    installmentsTotal: "",
    installmentsRemaining: "",
  };
}

function formFromTemplate(template: FixedExpenseTemplate): FormState {
  return {
    name: template.name,
    group: template.group,
    subgroup: template.subgroup ?? "",
    dueDay: template.dueDay === null ? "" : String(template.dueDay),
    expectedAmount:
      template.expectedAmountCents === null ? "" : formatMoneyInput(template.expectedAmountCents),
    isLoan: template.isLoan,
    installmentsTotal:
      template.installmentsTotal === null ? "" : String(template.installmentsTotal),
    installmentsRemaining:
      template.installmentsRemaining === null ? "" : String(template.installmentsRemaining),
  };
}

const AMOUNT_MESSAGE = "Informe o valor previsto, por exemplo 200,00, ou deixe em branco.";

/** Form fields that come before Valor previsto (for the order of the error messages). */
const FIELDS_BEFORE_AMOUNT = ["name", "group", "subgroup", "dueDay"];

/** An empty number field is "not filled in" (null); anything else goes to the schema. */
function numberOrNull(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado. Tente de novo.";
}

/** FR-13 preview on the template: "7 de 10 restantes", "a preencher" (Q-06) or "—". */
function installmentsText(template: FixedExpenseTemplate): string {
  if (!template.isLoan) return "—";
  if (template.installmentsTotal === null || template.installmentsRemaining === null) {
    return "a preencher";
  }
  return `${template.installmentsRemaining} de ${template.installmentsTotal} restantes`;
}

/**
 * Despesas fixas › Modelos (FR-10): the monthly bills #12 generates every month. Templates
 * are created, edited, deactivated and reordered; never deleted (deactivate instead).
 *
 * Keyboard (NFR-05): Nome → Grupo → Subgrupo → Dia de vencimento → Valor previsto →
 * Empréstimo → parcelas; Enter saves and focus returns to Nome. "Editar" loads a row into
 * the same form; Esc cancels.
 */
export function FixedExpenseTemplatesPage() {
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: QUERY_KEYS.fixedExpenseTemplates,
    queryFn: api.fixedExpenseTemplates.list,
  });

  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editing, setEditing] = useState<FixedExpenseTemplate | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const list = useMemo(() => templates.data ?? [], [templates.data]);

  // Subgroups already in use, offered as suggestions (e.g. "Telefonia").
  const subgroups = useMemo(
    () =>
      [...new Set(list.flatMap((template) => (template.subgroup ? [template.subgroup] : [])))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [list],
  );

  // ↑/↓ move within the group (FR-10); disabled on the first/last row of each group.
  const movable = useMemo(() => {
    const result = new Map<number, { up: boolean; down: boolean }>();
    for (const template of list) {
      result.set(template.id, {
        up: moveCategory(list, template.id, "up") !== null,
        down: moveCategory(list, template.id, "down") !== null,
      });
    }
    return result;
  }, [list]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fixedExpenseTemplates });

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CreateFixedExpenseTemplateInput }) =>
      id === null
        ? api.fixedExpenseTemplates.create(input)
        : api.fixedExpenseTemplates.update(id, input),
    onSuccess: async (_result, { id, input }) => {
      const label = fixedExpenseTemplateLabel(input);
      setSaved(id === null ? `Modelo ${label} adicionado.` : `Modelo ${label} salvo.`);
      // Keep the group: the owner usually types several bills of the same group in a row.
      setForm(emptyForm(input.group));
      setEditing(null);
      setFormError(null);
      await refresh();
      firstField.current?.focus();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const setActive = useMutation({
    mutationFn: ({ template, active }: { template: FixedExpenseTemplate; active: boolean }) =>
      api.fixedExpenseTemplates.update(template.id, { active }),
    onMutate: () => setSaved(null),
    onSuccess: async () => {
      setListError(null);
      await refresh();
    },
    onError: (error) => setListError(errorMessage(error)),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.fixedExpenseTemplates.reorder(ids),
    onMutate: () => setSaved(null),
    onSuccess: async () => {
      setListError(null);
      await refresh();
    },
    onError: (error) => setListError(errorMessage(error)),
  });

  const busy = setActive.isPending || reorder.isPending;

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(null);

    // An amount that is not a number is checked after the earlier fields, so the first
    // message is always about the first field to fix.
    const amountText = form.expectedAmount.trim();
    const amountCents = amountText === "" ? null : parseMoneyText(amountText);
    const amountIsMalformed = amountText !== "" && amountCents === null;

    // A subgroup typed in another case/accent reuses the existing spelling ("telefonia" →
    // "Telefonia"), so the same subgroup never shows up twice.
    const subgroupKey = categoryNameKey(form.subgroup);
    const subgroup = subgroups.find((known) => categoryNameKey(known) === subgroupKey);

    // The same schema as the server, so the messages are the same (FR-10).
    const parsed = createFixedExpenseTemplateInputSchema.safeParse({
      name: form.name,
      group: form.group,
      subgroup: subgroup ?? form.subgroup,
      dueDay: numberOrNull(form.dueDay),
      expectedAmountCents: amountCents,
      isLoan: form.isLoan,
      installmentsTotal: form.isLoan ? numberOrNull(form.installmentsTotal) : null,
      installmentsRemaining: form.isLoan ? numberOrNull(form.installmentsRemaining) : null,
    });
    const firstIssue = parsed.success ? undefined : parsed.error.issues[0];
    const issueBeforeAmount =
      firstIssue !== undefined && FIELDS_BEFORE_AMOUNT.includes(String(firstIssue.path[0]));
    if (amountIsMalformed && !issueBeforeAmount) return setFormError(AMOUNT_MESSAGE);
    if (!parsed.success) {
      return setFormError(firstIssue?.message ?? "Dados inválidos.");
    }
    const input = parsed.data;

    // FR-10: the same uniqueness rule as the server, checked here for a faster answer.
    const key = fixedExpenseTemplateNameKey(input);
    if (list.some((t) => t.id !== editing?.id && fixedExpenseTemplateNameKey(t) === key)) {
      return setFormError(FIXED_EXPENSE_TEMPLATE_TEXTS.duplicate);
    }
    save.mutate({ id: editing?.id ?? null, input });
  }

  function startEdit(template: FixedExpenseTemplate) {
    setEditing(template);
    setFormError(null);
    setSaved(null);
    setForm(formFromTemplate(template));
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

  function move(template: FixedExpenseTemplate, direction: "up" | "down") {
    const ids = moveCategory(list, template.id, direction);
    if (ids) reorder.mutate(ids);
  }

  function renderRow(template: FixedExpenseTemplate) {
    const label = fixedExpenseTemplateLabel(template);
    const canMove = movable.get(template.id) ?? { up: false, down: false };
    return (
      <TableRow
        key={template.id}
        className={cn(
          !template.active && "text-muted-foreground",
          editing?.id === template.id && "bg-muted",
        )}
      >
        <TableCell>{label}</TableCell>
        <TableCell className="w-32">
          {template.dueDay === null ? (
            <span className="text-muted-foreground">a preencher</span>
          ) : (
            `dia ${template.dueDay}`
          )}
        </TableCell>
        <TableCell className="w-36 whitespace-nowrap text-right">
          {template.expectedAmountCents === null ? "—" : formatCents(template.expectedAmountCents)}
        </TableCell>
        <TableCell className="w-40">{installmentsText(template)}</TableCell>
        <TableCell className="w-24">
          {template.active ? (
            <Badge variant="secondary">Ativo</Badge>
          ) : (
            <Badge variant="outline">Inativo</Badge>
          )}
        </TableCell>
        <TableCell className="w-64">
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Editar ${label}`}
              title="Editar"
              onClick={() => startEdit(template)}
            >
              <Pencil />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Mover ${label} para cima`}
              title="Mover para cima"
              disabled={!canMove.up || busy}
              onClick={() => move(template, "up")}
            >
              <ArrowUp />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Mover ${label} para baixo`}
              title="Mover para baixo"
              disabled={!canMove.down || busy}
              onClick={() => move(template, "down")}
            >
              <ArrowDown />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-24"
              aria-label={`${template.active ? "Desativar" : "Reativar"} ${label}`}
              disabled={busy}
              onClick={() => setActive.mutate({ template, active: !template.active })}
            >
              {template.active ? "Desativar" : "Reativar"}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  function renderGroup(group: FixedExpenseGroup) {
    const rows = list.filter((template) => template.group === group);
    const headingId = `fixed-group-${group}`;
    return (
      <section key={group} aria-labelledby={headingId} className="grid gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {FIXED_EXPENSE_GROUP_LABELS[group]}
        </h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor previsto</TableHead>
                  <TableHead>Parcelas</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Nenhum modelo neste grupo. Adicione um no formulário acima.
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

  return (
    <>
      <PageHeader
        title="Modelos de despesa fixa"
        description="As contas de todo mês. A cada mês, cada modelo ativo vira uma conta a pagar com o vencimento no dia informado. Desative os modelos que não se aplicam mais: as contas antigas continuam nos relatórios."
      />
      <p className="-mt-3 mb-4">
        <Link to="/despesas-fixas" className="text-primary underline-offset-4 hover:underline">
          ← Despesas fixas
        </Link>
      </p>

      <div className="max-w-5xl">
        <form
          onSubmit={submit}
          onKeyDown={cancelOnEscape}
          className="mb-4 flex flex-wrap items-end gap-3"
          noValidate
          aria-label={editing ? "Editar modelo" : "Novo modelo"}
        >
          {editing && (
            <p className="w-full rounded-md bg-muted px-3 py-2">
              Editando o modelo {fixedExpenseTemplateLabel(editing)} · Esc cancela
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="template-name">Nome</Label>
            <Input
              id="template-name"
              ref={firstField}
              // Data entry starts here (design system: focus on the first field).
              autoFocus
              className="w-48"
              autoComplete="off"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="template-group">Grupo</Label>
            <NativeSelect
              id="template-group"
              className="w-40"
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
            <Label htmlFor="template-subgroup">Subgrupo</Label>
            <Input
              id="template-subgroup"
              className="w-36"
              autoComplete="off"
              placeholder="opcional"
              list="template-subgroups"
              value={form.subgroup}
              onChange={(event) => set("subgroup", event.target.value)}
            />
            <datalist id="template-subgroups">
              {subgroups.map((subgroup) => (
                <option key={subgroup} value={subgroup} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="template-due-day">Dia de vencimento</Label>
            <Input
              id="template-due-day"
              type="number"
              min={1}
              max={31}
              className="w-32"
              value={form.dueDay}
              onChange={(event) => set("dueDay", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="template-amount">Valor previsto (R$)</Label>
            <Input
              id="template-amount"
              className="w-32 text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="opcional"
              value={form.expectedAmount}
              onChange={(event) => set("expectedAmount", event.target.value)}
            />
          </div>
          <label className="flex h-9 items-center gap-2" htmlFor="template-is-loan">
            <input
              id="template-is-loan"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              checked={form.isLoan}
              onChange={(event) => set("isLoan", event.target.checked)}
              onKeyDown={(event) => {
                // Enter submits from every field (design system), checkboxes included.
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
            Empréstimo
          </label>
          <div className="grid gap-1.5 has-[:disabled]:opacity-50">
            <Label htmlFor="template-installments-total">Total de parcelas</Label>
            <Input
              id="template-installments-total"
              type="number"
              min={1}
              max={MAX_LOAN_INSTALLMENTS}
              className="w-32"
              disabled={!form.isLoan}
              value={form.isLoan ? form.installmentsTotal : ""}
              onChange={(event) => set("installmentsTotal", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 has-[:disabled]:opacity-50">
            <Label htmlFor="template-installments-remaining">Parcelas restantes</Label>
            <Input
              id="template-installments-remaining"
              type="number"
              min={0}
              max={MAX_LOAN_INSTALLMENTS}
              className="w-32"
              disabled={!form.isLoan}
              value={form.isLoan ? form.installmentsRemaining : ""}
              onChange={(event) => set("installmentsRemaining", event.target.value)}
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
        {saved && !formError && (
          <p role="status" className="mb-4 text-muted-foreground">
            {saved}
          </p>
        )}
        {listError && (
          <p role="alert" className="mb-4 text-destructive">
            {listError}
          </p>
        )}
        {templates.error && (
          <p role="alert" className="text-destructive">
            Não foi possível carregar os modelos: {templates.error.message}
          </p>
        )}
        {templates.isPending && <p className="text-muted-foreground">Carregando…</p>}

        {templates.isSuccess && (
          <div className="grid gap-5">{FIXED_EXPENSE_GROUPS.map(renderGroup)}</div>
        )}

        <p className="mt-3 text-muted-foreground">
          Dia de vencimento: se o mês não tiver esse dia (ex.: 31 em fevereiro), a conta vence no
          último dia do mês. Empréstimo: informe o total de parcelas e quantas faltam; a cada
          pagamento, as parcelas restantes diminuem.
        </p>
      </div>
    </>
  );
}
