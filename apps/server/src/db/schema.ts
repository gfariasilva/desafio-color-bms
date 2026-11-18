import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Key/value application settings (spec §6.1 "Configuração", FR-33).
 * Example keys (added by later features): OneDrive folder, cash-difference alert limit.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  /** ISO-8601 UTC instant of the last change. */
  updatedAt: text("updated_at").notNull(),
});

/**
 * Audit log (spec §6.1 "RegistroAuditoria", FR-18). Insert-only: the API has no route to
 * edit or delete rows. Every business write adds its row in the same transaction
 * (see `recordAudit` in src/modules/audit/audit.repository.ts).
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** ISO-8601 UTC instant of the action. */
    at: text("at").notNull(),
    /** One of AUDIT_ENTITIES from @color-bms/core, e.g. "sale". */
    entity: text("entity").notNull(),
    /** Text so it also fits a day ("2026-11-18"), a month ("2026-11") or a setting key. */
    entityId: text("entity_id").notNull(),
    /** One of AUDIT_ACTIONS from @color-bms/core, e.g. "update". */
    action: text("action").notNull(),
    /** JSON object with the record before the action; null on creation. Money in cents. */
    beforeJson: text("before_json"),
    /** JSON object with the record after the action; null on deletion. Money in cents. */
    afterJson: text("after_json"),
    reason: text("reason"),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_entity_at_idx").on(table.entity, table.at),
  ],
);

/**
 * Sale tabs, "abas" (spec §6.1 "CategoriaVenda", FR-14). Seeded with RN-12 by the
 * `seed_categories` migration. Sales reference a tab by id, so renaming keeps the history.
 */
export const saleCategories = sqliteTable(
  "sale_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /**
     * `categoryNameKey(name)` from @color-bms/core: unique, ignoring case and accents.
     * A stored copy: if that rule changes, a data migration must recompute this column.
     */
    nameKey: text("name_key").notNull(),
    /** Display order, 1-based. */
    sortOrder: integer("sort_order").notNull(),
    /** Inactive tabs are hidden from the sale form but stay in reports (FR-14). */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("sale_categories_name_key_unique").on(table.nameKey)],
);

/**
 * General-expense categories (spec §6.1 "CategoriaDespesa", FR-14), in two groups:
 * `general` (Geral) and `suppliers` (Fornecedores de materiais). Seeded with RN-12.
 */
export const expenseCategories = sqliteTable(
  "expense_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /**
     * `categoryNameKey(name)` from @color-bms/core: unique, ignoring case and accents.
     * A stored copy: if that rule changes, a data migration must recompute this column.
     */
    nameKey: text("name_key").notNull(),
    /** One of EXPENSE_CATEGORY_GROUPS from @color-bms/core. */
    group: text("category_group", { enum: ["general", "suppliers"] }).notNull(),
    /** Display order, 1-based, across both groups. */
    sortOrder: integer("sort_order").notNull(),
    /** Inactive categories are hidden from the expense form but stay in reports (FR-14). */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("expense_categories_name_key_unique").on(table.nameKey)],
);

/**
 * Payment methods, "formas de pagamento" (spec §6.1 "FormaPagamento", FR-15). Seeded with
 * RN-12 by the `seed_payments` migration. Same list rules as the categories (FR-14).
 */
export const paymentMethods = sqliteTable(
  "payment_methods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** `categoryNameKey(name)` from @color-bms/core: unique, ignoring case and accents. */
    nameKey: text("name_key").notNull(),
    /** One of MACHINE_USAGES from @color-bms/core (FR-01 "Maquininha"). */
    machineUsage: text("machine_usage", {
      enum: ["required", "optional", "not_applicable"],
    }).notNull(),
    /** Whether a sale can be split into 1–12 installments (FR-01 "Parcelas"). */
    allowsInstallments: integer("allows_installments", { mode: "boolean" }).notNull(),
    /** Display order, 1-based. */
    sortOrder: integer("sort_order").notNull(),
    /** Inactive methods are hidden from the sale form but stay in reports. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("payment_methods_name_key_unique").on(table.nameKey)],
);

/**
 * Card machines, "maquininhas" (spec §6.1 "Maquininha", FR-15). Seeded with RN-12.
 * Same list rules as the categories (FR-14).
 */
export const cardMachines = sqliteTable(
  "card_machines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** `categoryNameKey(name)` from @color-bms/core: unique, ignoring case and accents. */
    nameKey: text("name_key").notNull(),
    /** Display order, 1-based. */
    sortOrder: integer("sort_order").notNull(),
    /** Inactive machines are hidden from the sale form but stay in reports. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("card_machines_name_key_unique").on(table.nameKey)],
);

/**
 * The fee table, "tabela de taxas" (spec §6.1 "TaxaMaquininha", FR-15): one row per
 * machine × payment method × installment range, with the rate and its "vigente desde".
 * RN-01 (`findFeeInForce` in @color-bms/core) picks the row for a sale.
 * Overlapping ranges for the same machine, method and date are blocked by the repository.
 */
export const cardFees = sqliteTable(
  "card_fees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardMachineId: integer("card_machine_id")
      .notNull()
      .references(() => cardMachines.id),
    paymentMethodId: integer("payment_method_id")
      .notNull()
      .references(() => paymentMethods.id),
    /** First installment count of the range, 1..12. */
    installmentsFrom: integer("installments_from").notNull(),
    /** Last installment count of the range, inclusive. */
    installmentsTo: integer("installments_to").notNull(),
    /** Percent × 10,000 (3,79% → 37900), ADR 0001. */
    ratePpm: integer("rate_ppm").notNull(),
    /** Civil date "YYYY-MM-DD" (RN-15) from which the rate applies. */
    validFrom: text("valid_from").notNull(),
  },
  (table) => [
    index("card_fees_lookup_idx").on(table.cardMachineId, table.paymentMethodId, table.validFrom),
    index("card_fees_payment_method_idx").on(table.paymentMethodId),
  ],
);
