import { z } from "zod";
import { DAY_STATUS_LABELS } from "../cash-closing/cash-closing";
import { EXPENSE_CATEGORY_GROUP_LABELS } from "../catalog/categories";
import { FIXED_EXPENSE_GROUP_LABELS } from "../fixed-expenses/fixed-expense-templates";
import { EXPENSE_STATUS_LABELS } from "../fixed-expenses/fixed-expenses";
import { formatCents } from "../format/currency";
import { MACHINE_USAGE_LABELS } from "../payments/payment-methods";
import { formatRatePercent } from "../payments/rate";
import { formatCivilDate, formatYearMonth } from "../format/date";
import { isCivilDate } from "../time/civil-date";
import { isYearMonth } from "../time/year-month";

/**
 * FR-18: audit log. Every business write records one entry in the same transaction:
 * when, which record (entity + id), what happened (action), the values before and after,
 * and an optional reason.
 *
 * Convention for `before`/`after`: plain JSON objects with English keys. Money fields end in
 * `Cents` and hold integer cents (e.g. `grossCents: 5000`), so the screen shows them as R$.
 */

/** The kinds of records the spec asks us to audit (FR-18). */
export const AUDIT_ENTITIES = [
  "sale",
  "refund",
  "expense",
  "cash_withdrawal",
  "day",
  "month",
  "sale_category",
  "expense_category",
  "payment_method",
  "card_machine",
  "card_fee",
  "fixed_expense_template",
  "setting",
  "backup",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  sale: "Venda",
  refund: "Estorno",
  expense: "Despesa",
  cash_withdrawal: "Sangria",
  day: "Dia",
  month: "Mês",
  sale_category: "Aba de venda",
  expense_category: "Categoria de despesa",
  payment_method: "Forma de pagamento",
  card_machine: "Maquininha",
  card_fee: "Taxa de maquininha",
  fixed_expense_template: "Modelo de despesa fixa",
  setting: "Configuração",
  backup: "Backup",
};

/** What happened to the record (FR-18). */
export const AUDIT_ACTIONS = ["create", "update", "delete", "close", "reopen", "restore"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
  close: "Fechamento",
  reopen: "Reabertura",
  restore: "Restauração",
};

/** A snapshot of a record's fields, stored as JSON. */
export type AuditValues = Record<string, unknown>;

export const auditEntrySchema = z.object({
  id: z.number().int().positive(),
  /** ISO-8601 UTC instant. */
  at: z.string().datetime(),
  entity: z.enum(AUDIT_ENTITIES),
  /** Text, so it also fits keys like a day ("2026-11-18") or a setting name. */
  entityId: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  reason: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Response of GET /api/audit: newest first. `hasMore` means older entries exist. */
export const auditListResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  hasMore: z.boolean(),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export const AUDIT_PAGE_DEFAULT = 200;
export const AUDIT_PAGE_MAX = 500;

function civilDateField(message: string) {
  return z.string().refine(isCivilDate, { message });
}

/** The filters of the audit log (FR-18: filter by date or type). */
const auditFilterFields = z.object({
  from: civilDateField("Data inicial inválida.").optional(),
  to: civilDateField("Data final inválida.").optional(),
  entity: z
    .enum(AUDIT_ENTITIES, { errorMap: () => ({ message: "Tipo de registro desconhecido." }) })
    .optional(),
  action: z.enum(AUDIT_ACTIONS, { errorMap: () => ({ message: "Ação desconhecida." }) }).optional(),
});

const dateRangeIsOrdered = {
  check: (filters: { from?: string; to?: string }) =>
    !filters.from || !filters.to || filters.from <= filters.to,
  message: "A data inicial deve ser anterior ou igual à data final.",
};

/**
 * Filters chosen on the Auditoria screen. Dates are civil dates in São Paulo (RN-15),
 * both inclusive. Error messages are pt-BR so the UI can show them.
 */
export const auditFiltersSchema = auditFilterFields.refine(dateRangeIsOrdered.check, {
  message: dateRangeIsOrdered.message,
  path: ["to"],
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Query string of GET /api/audit: the filters plus paging. */
export const auditQuerySchema = auditFilterFields
  .extend({
    limit: z.coerce
      .number({ message: "Limite inválido." })
      .int("Limite inválido.")
      .min(1, "Limite inválido.")
      .max(AUDIT_PAGE_MAX, `O limite máximo é ${AUDIT_PAGE_MAX}.`)
      .default(AUDIT_PAGE_DEFAULT),
    /** Cursor: return entries older than this id (the last id of the previous page). */
    beforeId: z.coerce
      .number({ message: "Cursor inválido." })
      .int("Cursor inválido.")
      .positive("Cursor inválido.")
      .optional(),
  })
  .refine(dateRangeIsOrdered.check, { message: dateRangeIsOrdered.message, path: ["to"] });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/**
 * pt-BR names for the fields that appear in `before`/`after`.
 * Later features add their own fields here; unknown fields are shown by their key.
 */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  active: "Ativa",
  order: "Ordem",
  date: "Data",
  amountCents: "Valor",
  grossCents: "Valor bruto",
  feeCents: "Taxa",
  netCents: "Valor líquido",
  note: "Observação",
  reason: "Motivo",
  status: "Situação",
  value: "Valor",
  group: "Grupo",
  machineUsage: "Uso da maquininha",
  allowsInstallments: "Permite parcelas",
  cardMachine: "Maquininha",
  paymentMethod: "Forma de pagamento",
  installmentsFrom: "Parcelas de",
  installmentsTo: "Parcelas até",
  ratePpm: "Taxa",
  validFrom: "Vigente desde",
  saleCategory: "Aba",
  installments: "Parcelas",
  feeRatePpm: "Percentual da taxa",
  paymentDate: "Data de pagamento",
  expenseCategory: "Categoria",
  description: "Descrição",
  paymentMeans: "Meio de pagamento",
  paidFromTill: "Pago do caixa",
  openingCashCents: "Troco inicial",
  cashSalesCents: "Vendas em dinheiro",
  tillExpensesCents: "Despesas pagas do caixa",
  withdrawalsCents: "Sangrias",
  expectedCashCents: "Dinheiro esperado",
  countedCashCents: "Dinheiro contado",
  differenceCents: "Diferença",
  templateGroup: "Grupo",
  subgroup: "Subgrupo",
  dueDay: "Dia de vencimento",
  expectedAmountCents: "Valor previsto",
  isLoan: "Empréstimo",
  installmentsTotal: "Total de parcelas",
  installmentsRemaining: "Parcelas restantes",
  expenseType: "Tipo",
  referenceMonth: "Mês de referência",
  dueDate: "Vencimento",
  expenseStatus: "Situação",
  installmentNumber: "Parcela",
  // FR-16: how many fixed expenses of the month were still pending when it was closed.
  pendingFixedExpenses: "Despesas fixas pendentes",
  // FR-33: settings (one audit row per key; the key is also the entity id).
  oneDriveFolder: "Pasta do OneDrive",
  cashDifferenceLimitCents: "Limite da diferença de caixa",
  dueSoonDays: "Antecedência de contas a vencer (dias)",
};

/** pt-BR labels for coded values, per field (e.g. an expense category's group). */
const AUDIT_VALUE_LABELS: Record<string, Record<string, string>> = {
  group: EXPENSE_CATEGORY_GROUP_LABELS,
  // A fixed-expense template's group (FR-10): a key of its own, since "general" is
  // "Geral" for expense categories but "Gerais" for templates.
  templateGroup: FIXED_EXPENSE_GROUP_LABELS,
  machineUsage: MACHINE_USAGE_LABELS,
  // A day's status (FR-08 closing, FR-09 reopening).
  status: DAY_STATUS_LABELS,
  // A fixed expense (FR-11, FR-12): its type and status.
  expenseType: { general: "Geral", fixed: "Fixa" },
  expenseStatus: EXPENSE_STATUS_LABELS,
};

/**
 * Formats one stored value for display: R$ for `*Cents`, a percent for `*Ppm` (fee rates,
 * percent × 10,000), dd/mm/aaaa for civil dates.
 */
function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (field.endsWith("Cents") && typeof value === "number" && Number.isSafeInteger(value)) {
    return formatCents(value);
  }
  if (
    field.endsWith("Ppm") &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return formatRatePercent(value);
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const valueLabels = Object.hasOwn(AUDIT_VALUE_LABELS, field) ? AUDIT_VALUE_LABELS[field] : null;
  if (typeof value === "string" && valueLabels && Object.hasOwn(valueLabels, value)) {
    return valueLabels[value] ?? value;
  }
  if (typeof value === "string" && field === "referenceMonth" && isYearMonth(value)) {
    return formatYearMonth(value);
  }
  if (typeof value === "string") return isCivilDate(value) ? formatCivilDate(value) : value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export interface AuditChange {
  field: string;
  /** pt-BR label, or the key itself when there is no label yet. */
  label: string;
  /** Formatted value before the action; null when the field did not exist (creation). */
  before: string | null;
  /** Formatted value after the action; null when the field no longer exists (deletion). */
  after: string | null;
}

/**
 * FR-18: lists the fields that differ between `before` and `after`, formatted for pt-BR.
 * A creation (no `before`) lists every new field; a deletion (no `after`) lists every old one.
 */
export function describeAuditChanges(
  before: AuditValues | null,
  after: AuditValues | null,
): AuditChange[] {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const changes: AuditChange[] = [];
  for (const field of fields) {
    // Object.hasOwn, not `in`: inherited keys such as "constructor" are not fields.
    const hadField = before !== null && Object.hasOwn(before, field);
    const hasField = after !== null && Object.hasOwn(after, field);
    const oldValue = before?.[field];
    const newValue = after?.[field];
    if (hadField && hasField && JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    changes.push({
      field,
      label: Object.hasOwn(AUDIT_FIELD_LABELS, field)
        ? (AUDIT_FIELD_LABELS[field] ?? field)
        : field,
      before: hadField ? formatAuditValue(field, oldValue) : null,
      after: hasField ? formatAuditValue(field, newValue) : null,
    });
  }
  return changes;
}
