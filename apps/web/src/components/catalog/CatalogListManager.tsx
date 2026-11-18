import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import {
  CATEGORY_IN_USE_CODE,
  CATEGORY_TEXTS,
  createSaleCategoryInputSchema,
  EXPENSE_CATEGORY_GROUP_LABELS,
  EXPENSE_CATEGORY_GROUPS,
  findCategoryWithSameName,
  MACHINE_USAGE_LABELS,
  MACHINE_USAGES,
  moveCategory,
  PAYMENT_LIST_TEXTS,
  type CategoryKind,
  type ExpenseCategoryGroup,
  type MachineUsage,
  type PaymentListKind,
} from "@color-bms/core";
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
import { api, ApiError, QUERY_KEYS } from "@/lib/api";
import { categoryColor } from "@/lib/category-colors";
import { cn } from "@/lib/utils";

/** The master-data lists this component manages: FR-14 categories and FR-15 payment lists. */
export type CatalogListKind = CategoryKind | PaymentListKind;

/**
 * One item of any list. Only expense categories have a group; only payment methods have
 * machine usage and installments.
 */
interface Category {
  id: number;
  name: string;
  order: number;
  active: boolean;
  group?: ExpenseCategoryGroup;
  machineUsage?: MachineUsage;
  allowsInstallments?: boolean;
}

interface CategoryChanges {
  name?: string;
  active?: boolean;
  group?: ExpenseCategoryGroup;
  machineUsage?: MachineUsage;
  allowsInstallments?: boolean;
}

/** What creating an item sends: the name plus the fields of its list. */
type CreateInput = Omit<CategoryChanges, "active"> & { name: string };

/** The API calls this screen needs, the same for every list. */
interface CategoryClient {
  list(): Promise<Category[]>;
  // The server validates the fields of each list with its own Zod schema.
  create(input: never): Promise<unknown>;
  update(id: number, changes: never): Promise<unknown>;
  reorder(ids: number[]): Promise<unknown>;
  remove(id: number): Promise<void>;
}

const CLIENTS: Record<CatalogListKind, CategoryClient> = {
  sale: api.saleCategories,
  expense: api.expenseCategories,
  payment_method: api.paymentMethods,
  card_machine: api.cardMachines,
};

/** Error messages shared with the server, from core. */
const SERVER_TEXTS: Record<CatalogListKind, { duplicate: string }> = {
  ...CATEGORY_TEXTS,
  ...PAYMENT_LIST_TEXTS,
};

/**
 * pt-BR texts that differ between the lists. Every noun is feminine (aba, categoria,
 * forma de pagamento, maquininha), so "a", "Ativa" and "Inativa" fit them all.
 */
const TEXTS: Record<
  CatalogListKind,
  { newLabel: string; noun: string; empty: string; footer: string }
> = {
  sale: {
    newLabel: "Nova aba",
    noun: "aba",
    empty: "Nenhuma aba cadastrada. Crie a primeira acima.",
    footer:
      "Abas inativas não aparecem nos lançamentos, mas continuam nos relatórios. Só é possível excluir uma aba que nunca foi usada.",
  },
  expense: {
    newLabel: "Nova categoria",
    noun: "categoria",
    empty: "Nenhuma categoria neste grupo.",
    footer:
      "Categorias inativas não aparecem nos lançamentos, mas continuam nos relatórios. Só é possível excluir uma categoria que nunca foi usada.",
  },
  payment_method: {
    newLabel: "Nova forma de pagamento",
    noun: "forma de pagamento",
    empty: "Nenhuma forma de pagamento cadastrada. Crie a primeira acima.",
    footer:
      "Formas inativas não aparecem no lançamento de vendas, mas continuam nos relatórios. Só é possível excluir uma forma que nunca foi usada (sem taxas nem vendas).",
  },
  card_machine: {
    newLabel: "Nova maquininha",
    noun: "maquininha",
    empty: "Nenhuma maquininha cadastrada. Crie a primeira acima.",
    footer:
      "Maquininhas inativas não aparecem no lançamento de vendas, mas continuam nos relatórios. Só é possível excluir uma maquininha que nunca foi usada (sem taxas nem vendas).",
  },
};

/** FR-01: "Parcelas" column and select values. */
const INSTALLMENT_OPTIONS = [
  { value: "false", label: "Não" },
  { value: "true", label: "Sim (1 a 12x)" },
];

/** Validates a name with the same Zod rule as the server (trim, 1–60 characters). */
function parseName(name: string): { name: string } | { error: string } {
  const parsed = createSaleCategoryInputSchema.safeParse({ name });
  if (parsed.success) return { name: parsed.data.name };
  return { error: parsed.error.issues[0]?.message ?? "Nome inválido." };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado. Tente de novo.";
}

/** An error shown above the list; `deactivate` offers "Desativar" when delete was blocked. */
interface ListError {
  message: string;
  deactivate?: Category;
}

/**
 * FR-14 / FR-15: manage one master-data list (sale tabs, expense categories, payment
 * methods or card machines).
 * Create, rename inline, move up/down, deactivate/reactivate and delete (only if never used).
 * Keyboard: Enter submits, Esc cancels a rename, focus returns to the name field after
 * creating so the next one can be typed right away (NFR-05).
 */
export function CatalogListManager({ kind }: { kind: CatalogListKind }) {
  const client = CLIENTS[kind];
  const texts = TEXTS[kind];
  const isPaymentMethod = kind === "payment_method";
  // Same wording as the server's 409, from core.
  const duplicateMessage = SERVER_TEXTS[kind].duplicate;
  const queryClient = useQueryClient();
  const queryKey = QUERY_KEYS[kind];

  const categories = useQuery({ queryKey, queryFn: () => client.list() });
  const list = categories.data ?? [];

  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<ExpenseCategoryGroup>("general");
  const [newMachineUsage, setNewMachineUsage] = useState<MachineUsage>("required");
  const [newAllowsInstallments, setNewAllowsInstallments] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<ListError | null>(null);
  const [editing, setEditing] = useState<{
    id: number;
    name: string;
    group?: ExpenseCategoryGroup;
    machineUsage?: MachineUsage;
    allowsInstallments?: boolean;
  } | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  // NFR-05: after a rename is saved or cancelled, the inline form disappears; put focus back
  // on that row's "Renomear" button so the keyboard user stays in place.
  const [focusRenameId, setFocusRenameId] = useState<number | null>(null);
  useEffect(() => {
    if (focusRenameId === null) return;
    container.current
      ?.querySelector<HTMLButtonElement>(`[data-rename-id="${focusRenameId}"]`)
      ?.focus();
    setFocusRenameId(null);
  }, [focusRenameId]);

  function closeRename(id: number) {
    setEditing(null);
    setFocusRenameId(id);
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: (input: CreateInput) => client.create(input as never),
    onSuccess: async () => {
      setNewName("");
      setFormError(null);
      await refresh();
      nameField.current?.focus();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const update = useMutation({
    mutationFn: ({ id, changes }: { id: number; changes: CategoryChanges }) =>
      client.update(id, changes as never),
    onSuccess: async (_result, { id }) => {
      if (editing?.id === id) closeRename(id);
      setListError(null);
      await refresh();
    },
    onError: (error) => setListError({ message: errorMessage(error) }),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => client.reorder(ids),
    onSuccess: refresh,
    onError: async (error) => {
      setListError({ message: errorMessage(error) });
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (category: Category) => client.remove(category.id),
    onSuccess: async () => {
      setListError(null);
      await refresh();
      // The deleted row (and its focused button) is gone: continue from the name field.
      nameField.current?.focus();
    },
    // FR-14: a used category cannot be deleted; offer to deactivate it instead.
    onError: (error, category) =>
      setListError({
        message: errorMessage(error),
        deactivate:
          error instanceof ApiError && error.code === CATEGORY_IN_USE_CODE && category.active
            ? category
            : undefined,
      }),
  });

  function submitNew(event: FormEvent) {
    event.preventDefault();
    const parsed = parseName(newName);
    if ("error" in parsed) return setFormError(parsed.error);
    if (findCategoryWithSameName(list, parsed.name)) return setFormError(duplicateMessage);
    const input: CreateInput = { name: parsed.name };
    if (kind === "expense") input.group = newGroup;
    if (isPaymentMethod) {
      input.machineUsage = newMachineUsage;
      input.allowsInstallments = newAllowsInstallments;
    }
    create.mutate(input);
  }

  function submitRename(event: FormEvent, category: Category) {
    event.preventDefault();
    if (!editing) return;
    const parsed = parseName(editing.name);
    if ("error" in parsed) return setListError({ message: parsed.error });
    if (findCategoryWithSameName(list, parsed.name, category.id)) {
      return setListError({ message: duplicateMessage });
    }
    const changes: CategoryChanges = {};
    if (parsed.name !== category.name) changes.name = parsed.name;
    if (editing.group && editing.group !== category.group) changes.group = editing.group;
    if (editing.machineUsage && editing.machineUsage !== category.machineUsage) {
      changes.machineUsage = editing.machineUsage;
    }
    if (
      editing.allowsInstallments !== undefined &&
      editing.allowsInstallments !== category.allowsInstallments
    ) {
      changes.allowsInstallments = editing.allowsInstallments;
    }
    if (Object.keys(changes).length === 0) return closeRename(category.id);
    update.mutate({ id: category.id, changes });
  }

  function cancelRename() {
    if (editing) closeRename(editing.id);
    setListError(null);
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  function move(category: Category, direction: "up" | "down") {
    const ids = moveCategory(list, category.id, direction);
    if (ids) reorder.mutate(ids);
  }

  function confirmDelete(category: Category) {
    const question = `Excluir a ${texts.noun} "${category.name}"? Esta ação não pode ser desfeita.`;
    if (window.confirm(question)) remove.mutate(category);
  }

  function setActive(category: Category, active: boolean) {
    update.mutate({ id: category.id, changes: { active } });
  }

  // Colors follow the display order, so a category keeps its color everywhere.
  const colorIndex = new Map(list.map((category, index) => [category.id, index]));
  const busy = update.isPending || reorder.isPending || remove.isPending;

  // First and last id of each group (one group for sale tabs): ↑ is disabled on the first,
  // ↓ on the last. Computed once per list instead of calling moveCategory for every row.
  const groupEnds = useMemo(() => {
    const first = new Map<string, number>();
    const last = new Map<string, number>();
    for (const category of categories.data ?? []) {
      const group = category.group ?? "";
      if (!first.has(group)) first.set(group, category.id);
      last.set(group, category.id);
    }
    return { first, last };
  }, [categories.data]);

  function renderRow(category: Category) {
    const isEditing = editing?.id === category.id;
    const canMoveUp = groupEnds.first.get(category.group ?? "") !== category.id;
    const canMoveDown = groupEnds.last.get(category.group ?? "") !== category.id;
    return (
      <TableRow key={category.id} className={cn(!category.active && "text-muted-foreground")}>
        <TableCell>
          {isEditing ? (
            <form
              onSubmit={(event) => submitRename(event, category)}
              className="flex items-center gap-2"
            >
              <Input
                aria-label={`Novo nome de ${category.name}`}
                className="h-8 max-w-xs"
                autoFocus
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                onKeyDown={cancelOnEscape}
              />
              {kind === "expense" && (
                <NativeSelect
                  aria-label={`Grupo de ${category.name}`}
                  className="h-8 w-56"
                  value={editing.group}
                  onChange={(event) =>
                    setEditing({ ...editing, group: event.target.value as ExpenseCategoryGroup })
                  }
                  onKeyDown={cancelOnEscape}
                >
                  {EXPENSE_CATEGORY_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {EXPENSE_CATEGORY_GROUP_LABELS[group]}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {isPaymentMethod && (
                <>
                  <NativeSelect
                    aria-label={`Uso da maquininha em ${category.name}`}
                    className="h-8 w-40"
                    value={editing.machineUsage}
                    onChange={(event) =>
                      setEditing({ ...editing, machineUsage: event.target.value as MachineUsage })
                    }
                    onKeyDown={cancelOnEscape}
                  >
                    {MACHINE_USAGES.map((usage) => (
                      <option key={usage} value={usage}>
                        {MACHINE_USAGE_LABELS[usage]}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label={`Parcelas em ${category.name}`}
                    className="h-8 w-36"
                    value={String(editing.allowsInstallments)}
                    onChange={(event) =>
                      setEditing({ ...editing, allowsInstallments: event.target.value === "true" })
                    }
                    onKeyDown={cancelOnEscape}
                  >
                    {INSTALLMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                </>
              )}
              <Button type="submit" size="sm" disabled={update.isPending}>
                Salvar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancelRename}>
                Cancelar
              </Button>
            </form>
          ) : (
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColor(colorIndex.get(category.id) ?? 0) }}
              />
              {category.name}
            </span>
          )}
        </TableCell>
        {isPaymentMethod && (
          <>
            <TableCell className="w-32">
              {category.machineUsage ? MACHINE_USAGE_LABELS[category.machineUsage] : "—"}
            </TableCell>
            <TableCell className="w-24">{category.allowsInstallments ? "Sim" : "Não"}</TableCell>
          </>
        )}
        <TableCell className="w-24">
          {category.active ? (
            <Badge variant="secondary">Ativa</Badge>
          ) : (
            <Badge variant="outline">Inativa</Badge>
          )}
        </TableCell>
        <TableCell className="w-[22rem]">
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Renomear ${category.name}`}
              data-rename-id={category.id}
              title="Renomear"
              disabled={isEditing}
              onClick={() => {
                setListError(null);
                setEditing({
                  id: category.id,
                  name: category.name,
                  group: category.group,
                  machineUsage: category.machineUsage,
                  allowsInstallments: category.allowsInstallments,
                });
              }}
            >
              <Pencil />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Mover ${category.name} para cima`}
              title="Mover para cima"
              disabled={!canMoveUp || busy}
              onClick={() => move(category, "up")}
            >
              <ArrowUp />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Mover ${category.name} para baixo`}
              title="Mover para baixo"
              disabled={!canMoveDown || busy}
              onClick={() => move(category, "down")}
            >
              <ArrowDown />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-24"
              aria-label={`${category.active ? "Desativar" : "Reativar"} ${category.name}`}
              disabled={busy}
              onClick={() => setActive(category, !category.active)}
            >
              {category.active ? "Desativar" : "Reativar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              aria-label={`Excluir ${category.name}`}
              title="Excluir (só se nunca foi usada)"
              disabled={busy}
              onClick={() => confirmDelete(category)}
            >
              <Trash2 />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  function renderTable(rows: Category[]) {
    return (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                {isPaymentMethod && (
                  <>
                    <TableHead>Maquininha</TableHead>
                    <TableHead>Parcelas</TableHead>
                  </>
                )}
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isPaymentMethod ? 5 : 3} className="text-muted-foreground">
                    {texts.empty}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(renderRow)
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={container} className="max-w-4xl">
      <form onSubmit={submitNew} className="mb-4 flex flex-wrap items-end gap-3" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`new-${kind}-category`}>{texts.newLabel}</Label>
          <Input
            id={`new-${kind}-category`}
            ref={nameField}
            className="w-72"
            autoComplete="off"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
        </div>
        {kind === "expense" && (
          <div className="grid gap-1.5">
            <Label htmlFor="new-expense-category-group">Grupo</Label>
            <NativeSelect
              id="new-expense-category-group"
              className="w-56"
              value={newGroup}
              onChange={(event) => setNewGroup(event.target.value as ExpenseCategoryGroup)}
            >
              {EXPENSE_CATEGORY_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {EXPENSE_CATEGORY_GROUP_LABELS[group]}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {isPaymentMethod && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="new-payment-method-usage">Maquininha</Label>
              <NativeSelect
                id="new-payment-method-usage"
                className="w-40"
                value={newMachineUsage}
                onChange={(event) => setNewMachineUsage(event.target.value as MachineUsage)}
              >
                {MACHINE_USAGES.map((usage) => (
                  <option key={usage} value={usage}>
                    {MACHINE_USAGE_LABELS[usage]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-payment-method-installments">Parcelas</Label>
              <NativeSelect
                id="new-payment-method-installments"
                className="w-36"
                value={String(newAllowsInstallments)}
                onChange={(event) => setNewAllowsInstallments(event.target.value === "true")}
              >
                {INSTALLMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </>
        )}
        <Button type="submit" disabled={create.isPending}>
          Adicionar
        </Button>
      </form>

      {formError && (
        <p role="alert" className="mb-4 text-destructive">
          {formError}
        </p>
      )}

      {listError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-destructive">
          <span>{listError.message}</span>
          {listError.deactivate && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Desativar ${listError.deactivate.name}`}
              onClick={() => listError.deactivate && setActive(listError.deactivate, false)}
            >
              Desativar
            </Button>
          )}
        </div>
      )}

      {categories.isError && (
        <p role="alert" className="text-destructive">
          Não foi possível carregar a lista: {categories.error.message}
        </p>
      )}
      {categories.isPending && <p className="text-muted-foreground">Carregando…</p>}

      {categories.isSuccess &&
        (kind === "expense" ? (
          <div className="grid gap-5">
            {EXPENSE_CATEGORY_GROUPS.map((group) => (
              <section key={group} className="grid gap-2">
                <h2 className="text-base font-semibold">{EXPENSE_CATEGORY_GROUP_LABELS[group]}</h2>
                {renderTable(list.filter((category) => category.group === group))}
              </section>
            ))}
          </div>
        ) : (
          renderTable(list)
        ))}

      <p className="mt-3 text-muted-foreground">{texts.footer}</p>
    </div>
  );
}
