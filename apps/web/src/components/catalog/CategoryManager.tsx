import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import {
  CATEGORY_IN_USE_CODE,
  createSaleCategoryInputSchema,
  EXPENSE_CATEGORY_GROUP_LABELS,
  EXPENSE_CATEGORY_GROUPS,
  findCategoryWithSameName,
  moveCategory,
  type CategoryKind,
  type ExpenseCategoryGroup,
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
import { api, ApiError } from "@/lib/api";
import { categoryColor } from "@/lib/category-colors";
import { cn } from "@/lib/utils";

/** A sale tab or an expense category; only expense categories have a group. */
interface Category {
  id: number;
  name: string;
  order: number;
  active: boolean;
  group?: ExpenseCategoryGroup;
}

interface CategoryChanges {
  name?: string;
  active?: boolean;
  group?: ExpenseCategoryGroup;
}

/** The API calls this screen needs, the same for both lists. */
interface CategoryClient {
  list(): Promise<Category[]>;
  create(input: { name: string; group?: ExpenseCategoryGroup }): Promise<unknown>;
  update(id: number, changes: CategoryChanges): Promise<unknown>;
  reorder(ids: number[]): Promise<unknown>;
  remove(id: number): Promise<void>;
}

const CLIENTS: Record<CategoryKind, CategoryClient> = {
  sale: api.saleCategories,
  expense: api.expenseCategories,
};

/** pt-BR texts that differ between the two lists. */
const TEXTS: Record<
  CategoryKind,
  { newLabel: string; article: string; noun: string; duplicate: string; empty: string }
> = {
  sale: {
    newLabel: "Nova aba",
    article: "a",
    noun: "aba",
    duplicate: "Já existe uma aba com esse nome.",
    empty: "Nenhuma aba cadastrada. Crie a primeira acima.",
  },
  expense: {
    newLabel: "Nova categoria",
    article: "a",
    noun: "categoria",
    duplicate: "Já existe uma categoria de despesa com esse nome.",
    empty: "Nenhuma categoria neste grupo.",
  },
};

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
 * FR-14: manage one category list (sale tabs or expense categories).
 * Create, rename inline, move up/down, deactivate/reactivate and delete (only if never used).
 * Keyboard: Enter submits, Esc cancels a rename, focus returns to the name field after
 * creating so the next one can be typed right away (NFR-05).
 */
export function CategoryManager({ kind }: { kind: CategoryKind }) {
  const client = CLIENTS[kind];
  const texts = TEXTS[kind];
  const queryClient = useQueryClient();
  const queryKey = ["categories", kind];

  const categories = useQuery({ queryKey, queryFn: () => client.list() });
  const list = categories.data ?? [];

  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<ExpenseCategoryGroup>("general");
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<ListError | null>(null);
  const [editing, setEditing] = useState<{
    id: number;
    name: string;
    group?: ExpenseCategoryGroup;
  } | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: (input: { name: string; group?: ExpenseCategoryGroup }) => client.create(input),
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
      client.update(id, changes),
    onSuccess: async () => {
      setEditing(null);
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
    if (findCategoryWithSameName(list, parsed.name)) return setFormError(texts.duplicate);
    create.mutate(
      kind === "expense" ? { name: parsed.name, group: newGroup } : { name: parsed.name },
    );
  }

  function submitRename(event: FormEvent, category: Category) {
    event.preventDefault();
    if (!editing) return;
    const parsed = parseName(editing.name);
    if ("error" in parsed) return setListError({ message: parsed.error });
    if (findCategoryWithSameName(list, parsed.name, category.id)) {
      return setListError({ message: texts.duplicate });
    }
    const changes: CategoryChanges = {};
    if (parsed.name !== category.name) changes.name = parsed.name;
    if (editing.group && editing.group !== category.group) changes.group = editing.group;
    if (Object.keys(changes).length === 0) return setEditing(null);
    update.mutate({ id: category.id, changes });
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
      setListError(null);
    }
  }

  function move(category: Category, direction: "up" | "down") {
    const ids = moveCategory(list, category.id, direction);
    if (ids) reorder.mutate(ids);
  }

  function confirmDelete(category: Category) {
    const question = `Excluir ${texts.article} ${texts.noun} "${category.name}"? Esta ação não pode ser desfeita.`;
    if (window.confirm(question)) remove.mutate(category);
  }

  function setActive(category: Category, active: boolean) {
    update.mutate({ id: category.id, changes: { active } });
  }

  // Colors follow the display order, so a category keeps its color everywhere.
  const colorIndex = new Map(list.map((category, index) => [category.id, index]));
  const busy = update.isPending || reorder.isPending || remove.isPending;

  function renderRow(category: Category) {
    const isEditing = editing?.id === category.id;
    const canMoveUp = moveCategory(list, category.id, "up") !== null;
    const canMoveDown = moveCategory(list, category.id, "down") !== null;
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
              <Button type="submit" size="sm" disabled={update.isPending}>
                Salvar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setListError(null);
                }}
              >
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
              title="Renomear"
              disabled={isEditing}
              onClick={() => {
                setListError(null);
                setEditing({ id: category.id, name: category.name, group: category.group });
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
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
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
    <div className="max-w-4xl">
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

      <p className="mt-3 text-muted-foreground">
        Categorias inativas não aparecem nos lançamentos, mas continuam nos relatórios. Só é
        possível excluir uma categoria que nunca foi usada.
      </p>
    </div>
  );
}
