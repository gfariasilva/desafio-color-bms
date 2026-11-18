import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

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

/**
 * Business days, "dias" (spec §6.1 "Dia"). **No row means the day is open**: the cash
 * closing (#9) inserts or updates the row; its cash fields are added then.
 * RN-14: nothing can be written with a date of a closed day.
 */
export const days = sqliteTable("days", {
  /** Civil date "YYYY-MM-DD" in São Paulo (RN-15). */
  date: text("date").primaryKey(),
  status: text("status", { enum: ["open", "closed"] }).notNull(),
  /** ISO-8601 UTC instant of the last closing; null while open. */
  closedAt: text("closed_at"),
});

/**
 * Months, "meses" (spec §6.1 "Mês"). **No row means the month is open**: the month closing
 * (#14) and the fixed-expense generation (#12) write it. RN-14: a closed month locks its days.
 */
export const months = sqliteTable("months", {
  /** "YYYY-MM". */
  yearMonth: text("year_month").primaryKey(),
  status: text("status", { enum: ["open", "closed"] }).notNull(),
  fixedExpensesGenerated: integer("fixed_expenses_generated", { mode: "boolean" })
    .notNull()
    .default(false),
  /** ISO-8601 UTC instant of the last closing; null while open. */
  closedAt: text("closed_at"),
});

/**
 * Sales and refunds, "vendas" (spec §6.1 "Venda", FR-01 to FR-04). The rate, fee and net
 * value are a **copy** made when the sale is saved (FR-02, spec §6.3): the fee table can
 * change without touching them. Daily and monthly totals are never stored (spec §6.3).
 */
export const sales = sqliteTable(
  "sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Civil date "YYYY-MM-DD" of the sale in São Paulo (RN-15). */
    date: text("date").notNull(),
    /** ISO-8601 UTC instant when it was registered. */
    createdAt: text("created_at").notNull(),
    /** One of SALE_TYPES from @color-bms/core; refunds come in #6. */
    type: text("type", { enum: ["sale", "refund"] }).notNull(),
    saleCategoryId: integer("sale_category_id")
      .notNull()
      .references(() => saleCategories.id),
    paymentMethodId: integer("payment_method_id")
      .notNull()
      .references(() => paymentMethods.id),
    /** Null for methods without a machine (Dinheiro, Boleto) and PIX paid directly. */
    cardMachineId: integer("card_machine_id").references(() => cardMachines.id),
    /** 1..12 for methods that allow installments (Crédito); null for the others. */
    installments: integer("installments"),
    /** Integer cents; negative for refunds (#6). */
    grossCents: integer("gross_cents").notNull(),
    /** Rate copied from the fee table: percent × 10,000 (ADR 0001). 0 without a fee. */
    feeRatePpm: integer("fee_rate_ppm").notNull(),
    /** RN-02: round(gross × rate), half-up, per sale. */
    feeCents: integer("fee_cents").notNull(),
    /** RN-03: gross − fee. */
    netCents: integer("net_cents").notNull(),
    /** The refunded sale (#6). */
    originalSaleId: integer("original_sale_id").references((): AnySQLiteColumn => sales.id),
    /** Required on refunds (#6). */
    reason: text("reason"),
    note: text("note"),
  },
  (table) => [
    index("sales_date_idx").on(table.date),
    index("sales_sale_category_idx").on(table.saleCategoryId),
    index("sales_payment_method_idx").on(table.paymentMethodId),
    index("sales_card_machine_idx").on(table.cardMachineId),
    index("sales_original_sale_idx").on(table.originalSaleId),
    // RN-03 as a last line of defence: a stored sale always adds up.
    check("sales_net_check", sql`${table.netCents} = ${table.grossCents} - ${table.feeCents}`),
  ],
);

/**
 * Expenses, "despesas" (spec §6.1 "Despesa"): general expenses (FR-06, `type: "general"`,
 * born `paid`) and, from #11–#13, fixed expenses (`type: "fixed"`). The columns of fixed
 * expenses are here already, so #12/#13 only add the template link (an additive migration).
 * Totals are never stored (spec §6.3).
 */
export const expenses = sqliteTable(
  "expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** One of EXPENSE_TYPES from @color-bms/core. */
    type: text("type", { enum: ["general", "fixed"] }).notNull(),
    /** One of EXPENSE_STATUSES; general expenses are always "paid". */
    status: text("status", { enum: ["pending", "paid", "dismissed"] }).notNull(),
    /** General expenses: exactly one category (RN-08, A-08). Null on fixed expenses. */
    expenseCategoryId: integer("expense_category_id").references(() => expenseCategories.id),
    description: text("description"),
    /** Integer cents paid. Null while a fixed expense is pending. */
    amountCents: integer("amount_cents"),
    /** Civil date "YYYY-MM-DD" of the payment (RN-08, RN-09, A-06). Null while pending. */
    paymentDate: text("payment_date"),
    /** One of EXPENSE_PAYMENT_MEANS (A-14). Null while a fixed expense is pending. */
    paymentMeans: text("payment_means", {
      enum: ["cash", "pix", "card", "boleto", "bank_transfer"],
    }),
    /** FR-06: paid with cash from the till (only with "cash"); reduces expected cash (RN-07). */
    paidFromTill: integer("paid_from_till", { mode: "boolean" }).notNull().default(false),
    /** Fixed expenses (#12): the month "YYYY-MM" the bill belongs to. */
    referenceMonth: text("reference_month"),
    /** Fixed expenses (#12): civil date due; may be in the future (RN-15). */
    dueDate: text("due_date"),
    /** Fixed expenses (#12): expected amount in integer cents, from the template. */
    expectedAmountCents: integer("expected_amount_cents"),
    /** Fixed expenses (#13): loan installment number. */
    installmentNumber: integer("installment_number"),
    /** ISO-8601 UTC instant when it was registered. */
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("expenses_payment_date_idx").on(table.paymentDate),
    index("expenses_expense_category_idx").on(table.expenseCategoryId),
    // FR-06: a general expense is paid, has one category, an amount > 0, a date and a means.
    check(
      "expenses_general_check",
      sql`${table.type} <> 'general' or (${table.status} = 'paid' and ${table.expenseCategoryId} is not null and ${table.amountCents} > 0 and ${table.paymentDate} is not null and ${table.paymentMeans} is not null)`,
    ),
    // FR-06: only cash can come from the till.
    check(
      "expenses_paid_from_till_check",
      sql`${table.paidFromTill} = 0 or ${table.paymentMeans} = 'cash'`,
    ),
  ],
);
