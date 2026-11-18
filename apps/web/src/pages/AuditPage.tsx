import { useState, type FormEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  addDays,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  auditQuerySchema,
  describeAuditChanges,
  formatCivilDate,
  formatInstant,
  isCivilDate,
  todayCivilDate,
  type AuditEntry,
  type AuditQuery,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { api } from "@/lib/api";

type Filters = Omit<AuditQuery, "limit" | "beforeId">;

interface FormValues {
  from: string;
  to: string;
  entity: string;
  action: string;
}

/** Default period: the last 30 days, ending today in São Paulo (RN-15). */
function defaultForm(): FormValues {
  const today = todayCivilDate();
  return { from: addDays(today, -30), to: today, entity: "", action: "" };
}

/** Shows what changed: one line per field, "before → after". */
function AuditChanges({ entry }: { entry: AuditEntry }) {
  const changes = describeAuditChanges(entry.before, entry.after);
  if (changes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="text-muted-foreground">{change.label}: </span>
          {change.before !== null && <span>{change.before}</span>}
          {change.before !== null && change.after !== null && (
            <span className="text-muted-foreground"> → </span>
          )}
          {change.after !== null && <span>{change.after}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Configurações › Auditoria (FR-18). Read-only on purpose: audit entries cannot be
 * edited or deleted, so this screen has no action buttons.
 */
export function AuditPage() {
  const [form, setForm] = useState<FormValues>(defaultForm);
  const [filters, setFilters] = useState<Filters>(() => ({ from: form.from, to: form.to }));
  const [formError, setFormError] = useState<string | null>(null);

  const audit = useInfiniteQuery({
    queryKey: ["audit", filters],
    queryFn: ({ pageParam }) => api.audit({ ...filters, beforeId: pageParam }),
    initialPageParam: undefined as number | undefined,
    // The next page starts before the oldest entry already shown.
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.entries[lastPage.entries.length - 1]?.id : undefined,
  });

  // Enter in any field submits (NFR-05). Same Zod schema as the server, same pt-BR messages.
  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const parsed = auditQuerySchema.safeParse({
      from: form.from || undefined,
      to: form.to || undefined,
      entity: form.entity || undefined,
      action: form.action || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Filtro inválido.");
      return;
    }
    setFormError(null);
    const { limit: _limit, beforeId: _beforeId, ...next } = parsed.data;
    setFilters(next);
  }

  function update(field: keyof FormValues) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  const entries = audit.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro automático de criações, edições, exclusões, fechamentos e reaberturas. Somente leitura."
      />
      <p className="-mt-3 mb-4">
        <Link to="/configuracoes" className="text-primary underline-offset-4 hover:underline">
          ← Configurações
        </Link>
      </p>

      <form
        onSubmit={applyFilters}
        className="mb-4 flex flex-wrap items-end gap-3"
        aria-label="Filtros da auditoria"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="audit-from">De</Label>
          <Input
            id="audit-from"
            type="date"
            className="w-40"
            value={form.from}
            onChange={update("from")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-to">Até</Label>
          <Input
            id="audit-to"
            type="date"
            className="w-40"
            value={form.to}
            onChange={update("to")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-entity">Tipo</Label>
          <NativeSelect
            id="audit-entity"
            className="w-52"
            value={form.entity}
            onChange={update("entity")}
          >
            <option value="">Todos</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {AUDIT_ENTITY_LABELS[entity]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-action">Ação</Label>
          <NativeSelect
            id="audit-action"
            className="w-40"
            value={form.action}
            onChange={update("action")}
          >
            <option value="">Todas</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">Filtrar</Button>
      </form>

      {formError && (
        <p role="alert" className="mb-4 text-destructive">
          {formError}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {audit.isError && (
            <p role="alert" className="p-4 text-destructive">
              Não foi possível carregar a auditoria: {audit.error.message}
            </p>
          )}
          {audit.isPending && <p className="p-4 text-muted-foreground">Carregando…</p>}
          {audit.isSuccess && entries.length === 0 && (
            <p className="p-4 text-muted-foreground">Nenhum registro de auditoria neste período.</p>
          )}
          {entries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Data e hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Alterações</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatInstant(entry.at)}</TableCell>
                    <TableCell>{AUDIT_ENTITY_LABELS[entry.entity]}</TableCell>
                    <TableCell>{AUDIT_ACTION_LABELS[entry.action]}</TableCell>
                    <TableCell className="tabular-nums">
                      {/* Days are identified by their date ("2026-11-17" → 17/11/2026). */}
                      {isCivilDate(entry.entityId)
                        ? formatCivilDate(entry.entityId)
                        : entry.entityId}
                    </TableCell>
                    <TableCell>
                      <AuditChanges entry={entry} />
                    </TableCell>
                    <TableCell>{entry.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {audit.hasNextPage && (
        <Button
          variant="outline"
          className="mt-3"
          disabled={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {audit.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
        </Button>
      )}
    </>
  );
}
