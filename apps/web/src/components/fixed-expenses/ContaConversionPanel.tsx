import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FIXED_EXPENSE_GROUP_LABELS,
  FIXED_EXPENSE_GROUPS,
  formatCents,
  formatCivilDate,
  formatYearMonth,
  type ContaCandidate,
  type ConvertContaInput,
  type FixedExpenseGroup,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

/**
 * "new" pays a new one-off bill; a number pays that pending bill. It starts as "new": a note
 * like "CONTA: Luz outubro" must not pay November's Luz by accident; the owner picks.
 */
type Target = "new" | number;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado. Tente de novo.";
}

/**
 * #13: converts the pilot's interim records. Until bills could be paid (FR-12), a bill paid
 * with cash from the till was a sangria whose note starts with "CONTA:". Each one becomes a
 * paid fixed expense (same date and amount, Dinheiro, paid from the till): either a pending
 * bill the owner picks or a new one-off bill named after the note. On a closed day the server
 * reopens the day, converts and closes it again with the same count (RN-14, RN-07); the owner
 * confirms each one. Shown only while there is something to convert.
 */
export function ContaConversionPanel({ onConverted }: { onConverted: (text: string) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEYS.contaConversions,
    queryFn: api.contaConversions.list,
  });
  const [targets, setTargets] = useState<Record<number, Target>>({});
  const [groups, setGroups] = useState<Record<number, FixedExpenseGroup>>({});
  const [error, setError] = useState<string | null>(null);

  const convert = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ConvertContaInput }) =>
      api.contaConversions.convert(id, input),
    onSuccess: async (expense, { id }) => {
      setError(null);
      setTargets(({ [id]: _done, ...rest }) => rest);
      onConverted(
        `Sangria convertida: ${expense.label} paga em ${formatCivilDate(expense.paymentDate ?? "")}, ${formatCents(expense.amountCents ?? 0)} do caixa.`,
      );
      // A conversion touches bills, sangrias and the day's closing.
      await Promise.all(
        [QUERY_KEYS.fixedExpenses, QUERY_KEYS.cashWithdrawals, QUERY_KEYS.cashClosing].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const data = query.data;
  if (!data || data.withdrawals.length === 0) return null;

  function confirmConvert(candidate: ContaCandidate) {
    const target = targets[candidate.id] ?? "new";
    const bill =
      target === "new"
        ? `uma nova conta avulsa "${candidate.suggestedName || "Conta do piloto"}"`
        : `a conta ${data!.pendingExpenses.find((expense) => expense.id === target)?.label ?? ""}`;
    const dayNote = candidate.dayClosed
      ? ` O dia ${formatCivilDate(candidate.date)} será reaberto e fechado de novo com a mesma contagem.`
      : "";
    const question = `Converter a sangria de ${formatCents(candidate.amountCents)} de ${formatCivilDate(candidate.date)} em ${bill}, paga em dinheiro do caixa?${dayNote}`;
    if (!window.confirm(question)) return;
    const input: ConvertContaInput =
      target === "new"
        ? {
            target: "one_off",
            name: candidate.suggestedName || "Conta do piloto",
            group: groups[candidate.id] ?? "general",
          }
        : { target: "existing", fixedExpenseId: target };
    convert.mutate({ id: candidate.id, input });
  }

  return (
    <section aria-labelledby="conta-conversion-title" className="mb-5 grid gap-2">
      <h2 id="conta-conversion-title" className="text-base font-semibold">
        Sangrias “CONTA:” do piloto
      </h2>
      <p className="text-muted-foreground">
        Antes desta tela, as contas pagas com dinheiro do caixa eram lançadas como sangria com a
        observação “CONTA:”. Converta cada uma em conta paga: o dinheiro esperado do dia não muda.
      </p>
      <Card>
        <CardContent className="p-0">
          <Table aria-labelledby="conta-conversion-title">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead>Converter em</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.withdrawals.map((candidate) => {
                const target = targets[candidate.id] ?? "new";
                return (
                  <TableRow key={candidate.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatCivilDate(candidate.date)}
                      {candidate.dayClosed ? (
                        <span className="text-muted-foreground"> · dia fechado</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatCents(candidate.amountCents)}
                    </TableCell>
                    <TableCell>{candidate.note}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-2">
                        <NativeSelect
                          aria-label={`Converter a sangria de ${formatCivilDate(candidate.date)} em`}
                          className="w-64"
                          value={String(target)}
                          onChange={(event) =>
                            setTargets((current) => ({
                              ...current,
                              [candidate.id]:
                                event.target.value === "new" ? "new" : Number(event.target.value),
                            }))
                          }
                        >
                          <option value="new">
                            Nova conta avulsa: {candidate.suggestedName || "Conta do piloto"}
                          </option>
                          {data.pendingExpenses.map((expense) => (
                            <option key={expense.id} value={expense.id}>
                              {expense.label} ({formatYearMonth(expense.referenceMonth)})
                            </option>
                          ))}
                        </NativeSelect>
                        {target === "new" ? (
                          <NativeSelect
                            aria-label={`Grupo da nova conta de ${formatCivilDate(candidate.date)}`}
                            className="w-36"
                            value={groups[candidate.id] ?? "general"}
                            onChange={(event) =>
                              setGroups((current) => ({
                                ...current,
                                [candidate.id]: event.target.value as FixedExpenseGroup,
                              }))
                            }
                          >
                            {FIXED_EXPENSE_GROUPS.map((group) => (
                              <option key={group} value={group}>
                                {FIXED_EXPENSE_GROUP_LABELS[group]}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={convert.isPending}
                        onClick={() => confirmConvert(candidate)}
                      >
                        Converter
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
