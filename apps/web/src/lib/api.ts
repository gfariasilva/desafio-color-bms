import {
  contaCandidatesResponseSchema,
  type ContaCandidatesResponse,
  type ConvertContaInput,
  type PayFixedExpenseInput,
  fixedExpenseSchema,
  monthFixedExpensesResponseSchema,
  type CreateOneOffFixedExpenseInput,
  type FixedExpense,
  type MonthFixedExpensesResponse,
  fixedExpenseTemplateListResponseSchema,
  fixedExpenseTemplateSchema,
  type CreateFixedExpenseTemplateInput,
  type FixedExpenseTemplate,
  type UpdateFixedExpenseTemplateInput,
  cardFeeInForceResponseSchema,
  cardFeeListResponseSchema,
  cardFeeSchema,
  cardMachineListResponseSchema,
  cardMachineSchema,
  paymentMethodListResponseSchema,
  paymentMethodSchema,
  type CardFee,
  type CardFeeInForceQuery,
  type CardFeeInput,
  type CardMachine,
  type CreateCardMachineInput,
  type CreatePaymentMethodInput,
  type PaymentMethod,
  type UpdateCardMachineInput,
  type UpdatePaymentMethodInput,
  auditListResponseSchema,
  expenseCategoryListResponseSchema,
  expenseCategorySchema,
  saleCategoryListResponseSchema,
  saleCategorySchema,
  type CreateExpenseCategoryInput,
  type CreateSaleCategoryInput,
  type ExpenseCategory,
  type SaleCategory,
  type UpdateExpenseCategoryInput,
  type UpdateSaleCategoryInput,
  healthResponseSchema,
  backupStatusResponseSchema,
  backupListResponseSchema,
  backupUploadResponseSchema,
  restoreResponseSchema,
  type BackupListResponse,
  type BackupUploadResponse,
  type RestoreRequest,
  type RestoreResponse,
  exportQueueStatusResponseSchema,
  type BackupStatusResponse,
  type ExportQueueStatusResponse,
  folderTestResponseSchema,
  settingsResponseSchema,
  type FolderTestResponse,
  type SettingsInput,
  type SettingsResponse,
  dayReportResponseSchema,
  type DayReportResponse,
  monthFixedExpensesReportSchema,
  monthGeneralExpensesResponseSchema,
  monthIncomeResponseSchema,
  monthSummarySchema,
  monthComparisonSchema,
  type MonthComparison,
  type MonthFixedExpensesReport,
  type MonthGeneralExpensesResponse,
  type MonthIncomeResponse,
  type MonthSummary,
  dayCashClosingResponseSchema,
  unclosedDaysResponseSchema,
  type CloseDayInput,
  type ReopenDayInput,
  monthClosingResponseSchema,
  type MonthClosingResponse,
  type ReopenMonthInput,
  type DayCashClosingResponse,
  cashWithdrawalSchema,
  dayCashWithdrawalsResponseSchema,
  type CashWithdrawal,
  type CreateCashWithdrawalInput,
  type DayCashWithdrawalsResponse,
  type UpdateCashWithdrawalInput,
  dayExpensesResponseSchema,
  expenseSchema,
  type CreateExpenseInput,
  type DayExpensesResponse,
  type Expense,
  type UpdateExpenseInput,
  daySalesResponseSchema,
  saleSchema,
  todayResponseSchema,
  type CreateRefundInput,
  type CreateSaleInput,
  type DaySalesResponse,
  type Sale,
  type UpdateSaleInput,
  type AuditListResponse,
  type AuditQuery,
  type HealthResponse,
} from "@color-bms/core";
import type { z } from "zod";

/** Thrown when the server answers with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Machine-readable reason sent by the server, e.g. CATEGORY_IN_USE_CODE. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * GET a JSON endpoint and validate it with a shared Zod schema from @color-bms/core,
 * so the UI never works with data of an unexpected shape.
 */
async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  return requestJson("GET", url, undefined, schema);
}

/**
 * Sends a request with an optional JSON body. Validates the answer with `schema`, or ignores
 * it when `schema` is undefined (e.g. 204 No Content).
 */
async function requestJson<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T>;
async function requestJson(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body: unknown,
): Promise<void>;
async function requestJson<T>(
  method: string,
  url: string,
  body: unknown,
  schema?: z.ZodType<T>,
): Promise<T | void> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // The server sends pt-BR messages as { error: "…", code?: "…" } (e.g. a duplicate name).
    const data = (await response.json().catch(() => null)) as {
      error?: unknown;
      code?: unknown;
    } | null;
    const message =
      typeof data?.error === "string"
        ? data.error
        : `${method} ${url} failed with ${response.status}`;
    throw new ApiError(
      response.status,
      message,
      typeof data?.code === "string" ? data.code : undefined,
    );
  }
  if (!schema) return;
  return schema.parse(await response.json());
}

/** Builds a query string, skipping empty values. */
function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * TanStack Query keys of the lists, shared by every screen that reads them, so a change on
 * one screen refreshes the others (e.g. a new machine appears in the fee table form).
 */
export const QUERY_KEYS = {
  sale: ["categories", "sale"],
  expense: ["categories", "expense"],
  payment_method: ["paymentMethods"],
  card_machine: ["cardMachines"],
  card_fees: ["cardFees"],
  /** FR-10: fixed-expense templates, in display order. */
  fixedExpenseTemplates: ["fixedExpenseTemplates"],
  /** Prefix of every fixed-expense query; any change (or a template edit) invalidates it. */
  fixedExpenses: ["fixedExpenses"],
  /** FR-11: followed by the month: ["fixedExpenses", "month", "2026-11"]. */
  fixedExpensesMonth: ["fixedExpenses", "month"],
  /** #13: the CONTA: sangrias left to convert (under fixedExpenses: a payment refreshes it). */
  contaConversions: ["fixedExpenses", "contaConversions"],
  today: ["today"],
  /** Prefix of every sales query; any sale change invalidates it all. */
  sales: ["sales"],
  /** FR-05: followed by the civil date: ["sales", "day", "2026-11-18"] (a DaySalesResponse). */
  salesDay: ["sales", "day"],
  /** Prefix of every expense query; any expense change invalidates it all. */
  expenses: ["expenses"],
  /** FR-06: followed by the civil date: ["expenses", "day", "2026-11-18"]. */
  expensesDay: ["expenses", "day"],
  /** Prefix of every sangria query; any sangria change invalidates it all. */
  cashWithdrawals: ["cashWithdrawals"],
  /** FR-07: followed by the civil date: ["cashWithdrawals", "day", "2026-11-18"]. */
  cashWithdrawalsDay: ["cashWithdrawals", "day"],
  /** Prefix of every cash-closing query; a closing invalidates it all. */
  cashClosing: ["cashClosing"],
  /** FR-08: followed by the civil date: ["cashClosing", "day", "2026-11-18"]. */
  cashClosingDay: ["cashClosing", "day"],
  /** FR-27: earlier days with movement still open. */
  unclosedDays: ["cashClosing", "unclosed"],
  /** GET /api/health: version, startup checks and trial mode (#26). */
  health: ["health"],
  /** FR-31: the backup's state (Início, the backup page). */
  backupStatus: ["backup", "status"],
  /** FR-32: the backups that can be restored. */
  backupFiles: ["backup", "files"],
  /** FR-30 (#21): the export queue (daily spreadsheets), shown on Início. */
  exportStatus: ["exports", "status"],
  /** FR-33: Configurações. */
  settings: ["settings"],
  /** FR-16: followed by the month: ["cashClosing", "month", "2026-10"]. */
  monthClosing: ["cashClosing", "month"],
  /** FR-19: followed by the civil date: ["reports", "day", "2026-11-18"]. */
  dayReport: ["reports", "day"],
  /** FR-20: followed by the month: ["reports", "monthIncome", "2026-10"]. */
  monthIncomeReport: ["reports", "monthIncome"],
  /** FR-21: followed by the month: ["reports", "monthGeneralExpenses", "2026-10"]. */
  monthGeneralExpensesReport: ["reports", "monthGeneralExpenses"],
  /** FR-22: followed by the month: ["reports", "monthFixedExpenses", "2026-10"]. */
  monthFixedExpensesReport: ["reports", "monthFixedExpenses"],
  /** FR-23: followed by the month: ["reports", "monthSummary", "2026-10"]. */
  monthSummaryReport: ["reports", "monthSummary"],
  /** FR-24: this month × the same days of the previous month (no parameter: today). */
  monthComparison: ["dashboards", "monthComparison"],
} as const;

export const api = {
  health: (): Promise<HealthResponse> => getJson("/api/health", healthResponseSchema),
  /** FR-31 / FR-32: the newest backup, the last restore, and the server's start id. */
  backupStatus: (): Promise<BackupStatusResponse> =>
    getJson("/api/backup/status", backupStatusResponseSchema),
  /** FR-32: the backups on OneDrive and on this PC, newest first. */
  backupFiles: (): Promise<BackupListResponse> =>
    getJson("/api/backup/files", backupListResponseSchema),
  /** FR-32 (new PC): sends a backup file chosen on the computer; the server checks it. */
  uploadBackup: async (file: File): Promise<BackupUploadResponse> => {
    const url = `/api/backup/upload?name=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
      body: file,
    });
    const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!response.ok) {
      throw new ApiError(
        response.status,
        typeof data?.error === "string" ? data.error : "Não foi possível enviar o arquivo.",
      );
    }
    return backupUploadResponseSchema.parse(data);
  },
  /** FR-32: restores a backup; the server answers, then restarts. */
  restoreBackup: (request: RestoreRequest): Promise<RestoreResponse> =>
    requestJson("POST", "/api/backup/restore", request, restoreResponseSchema),
  /** FR-30: the exports not written yet ("Backup pendente"). */
  exportStatus: (): Promise<ExportQueueStatusResponse> =>
    getJson("/api/exports/status", exportQueueStatusResponseSchema),
  /** FR-30 "Tentar agora": tries every pending export now and returns the new state. */
  retryExports: (): Promise<ExportQueueStatusResponse> =>
    requestJson("POST", "/api/exports/retry", undefined, exportQueueStatusResponseSchema),
  /** FR-33: the settings in effect (defaults filled in). */
  settings: (): Promise<SettingsResponse> => getJson("/api/settings", settingsResponseSchema),
  /** FR-33: saves the settings; a new folder that fails "Testar" is refused (422). */
  saveSettings: (input: SettingsInput): Promise<SettingsResponse> =>
    requestJson("PUT", "/api/settings", input, settingsResponseSchema),
  /** FR-33 "Testar": writes and deletes a test file in the folder; never saves. */
  testOneDriveFolder: (folder: string): Promise<FolderTestResponse> =>
    requestJson("POST", "/api/settings/onedrive-folder/test", { folder }, folderTestResponseSchema),
  /** FR-18: read-only audit log, newest first. */
  audit: (query: Partial<AuditQuery>): Promise<AuditListResponse> =>
    getJson(`/api/audit${toQueryString(query)}`, auditListResponseSchema),

  /** RN-15: today's civil date in São Paulo, from the server clock (ADR 0002). */
  today: (): Promise<string> => getJson("/api/today", todayResponseSchema).then((r) => r.date),

  /** FR-01 to FR-05: the day per tab, registering, editing, deleting and refunding. */
  sales: {
    /** FR-05: the day grouped by tab, with subtotals per method and totals (RN-05). */
    day: (date: string): Promise<DaySalesResponse> =>
      getJson(`/api/days/${encodeURIComponent(date)}/sales`, daySalesResponseSchema),
    create: (input: CreateSaleInput): Promise<Sale> =>
      requestJson("POST", "/api/sales", input, saleSchema),
    update: (id: number, input: UpdateSaleInput): Promise<Sale> =>
      requestJson("PATCH", `/api/sales/${id}`, input, saleSchema),
    /** FR-03: deletes a sale; also a refund on an open day (RN-14). */
    remove: (id: number): Promise<void> => requestJson("DELETE", `/api/sales/${id}`, undefined),
    /** FR-04: refunds all or part of a sale from an earlier day; the refund is dated today. */
    refund: (id: number, input: CreateRefundInput): Promise<Sale> =>
      requestJson("POST", `/api/sales/${id}/refunds`, input, saleSchema),
  },

  /** FR-06: general expenses (saídas diárias): the day, registering, editing, deleting. */
  expenses: {
    day: (date: string): Promise<DayExpensesResponse> =>
      getJson(`/api/days/${encodeURIComponent(date)}/expenses`, dayExpensesResponseSchema),
    create: (input: CreateExpenseInput): Promise<Expense> =>
      requestJson("POST", "/api/expenses", input, expenseSchema),
    update: (id: number, input: UpdateExpenseInput): Promise<Expense> =>
      requestJson("PATCH", `/api/expenses/${id}`, input, expenseSchema),
    remove: (id: number): Promise<void> => requestJson("DELETE", `/api/expenses/${id}`, undefined),
  },

  /** FR-07: sangrias (cash withdrawals): the day, registering, editing, deleting. */
  cashWithdrawals: {
    day: (date: string): Promise<DayCashWithdrawalsResponse> =>
      getJson(
        `/api/days/${encodeURIComponent(date)}/cash-withdrawals`,
        dayCashWithdrawalsResponseSchema,
      ),
    create: (input: CreateCashWithdrawalInput): Promise<CashWithdrawal> =>
      requestJson("POST", "/api/cash-withdrawals", input, cashWithdrawalSchema),
    update: (id: number, input: UpdateCashWithdrawalInput): Promise<CashWithdrawal> =>
      requestJson("PATCH", `/api/cash-withdrawals/${id}`, input, cashWithdrawalSchema),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/cash-withdrawals/${id}`, undefined),
  },

  /** FR-19: the day report; FR-20 to FR-23: the month reports. */
  reports: {
    day: (date: string): Promise<DayReportResponse> =>
      getJson(`/api/days/${encodeURIComponent(date)}/report`, dayReportResponseSchema),
    monthIncome: (yearMonth: string): Promise<MonthIncomeResponse> =>
      getJson(
        `/api/months/${encodeURIComponent(yearMonth)}/reports/income`,
        monthIncomeResponseSchema,
      ),
    monthGeneralExpenses: (yearMonth: string): Promise<MonthGeneralExpensesResponse> =>
      getJson(
        `/api/months/${encodeURIComponent(yearMonth)}/reports/general-expenses`,
        monthGeneralExpensesResponseSchema,
      ),
    monthFixedExpenses: (yearMonth: string): Promise<MonthFixedExpensesReport> =>
      getJson(
        `/api/months/${encodeURIComponent(yearMonth)}/reports/fixed-expenses`,
        monthFixedExpensesReportSchema,
      ),
    monthSummary: (yearMonth: string): Promise<MonthSummary> =>
      getJson(`/api/months/${encodeURIComponent(yearMonth)}/reports/summary`, monthSummarySchema),
  },

  /** FR-24 to FR-26: the dashboards. */
  dashboards: {
    /** FR-24: this month up to today against the same days of the previous month. */
    monthComparison: (): Promise<MonthComparison> =>
      getJson("/api/dashboards/month-comparison", monthComparisonSchema),
  },

  /** FR-08: the cash closing of a day; FR-27: the earlier days left open. */
  cashClosing: {
    day: (date: string): Promise<DayCashClosingResponse> =>
      getJson(`/api/days/${encodeURIComponent(date)}/cash-closing`, dayCashClosingResponseSchema),
    close: (date: string, input: CloseDayInput): Promise<DayCashClosingResponse> =>
      requestJson(
        "POST",
        `/api/days/${encodeURIComponent(date)}/close`,
        input,
        dayCashClosingResponseSchema,
      ),
    /** FR-09: reopen a closed day with a reason; answers with the day, open again. */
    reopen: (date: string, input: ReopenDayInput): Promise<DayCashClosingResponse> =>
      requestJson(
        "POST",
        `/api/days/${encodeURIComponent(date)}/reopen`,
        input,
        dayCashClosingResponseSchema,
      ),
    unclosed: (): Promise<string[]> =>
      getJson("/api/days/unclosed", unclosedDaysResponseSchema).then((r) => r.days),
  },

  /** FR-16: close a month; FR-17: reopen it with a reason. */
  monthClosing: {
    month: (yearMonth: string): Promise<MonthClosingResponse> =>
      getJson(`/api/months/${encodeURIComponent(yearMonth)}/closing`, monthClosingResponseSchema),
    close: (yearMonth: string): Promise<MonthClosingResponse> =>
      requestJson(
        "POST",
        `/api/months/${encodeURIComponent(yearMonth)}/close`,
        {},
        monthClosingResponseSchema,
      ),
    reopen: (yearMonth: string, input: ReopenMonthInput): Promise<MonthClosingResponse> =>
      requestJson(
        "POST",
        `/api/months/${encodeURIComponent(yearMonth)}/reopen`,
        input,
        monthClosingResponseSchema,
      ),
  },

  /** FR-14: sale tabs (abas), in display order. */
  saleCategories: {
    list: (): Promise<SaleCategory[]> =>
      getJson("/api/sale-categories", saleCategoryListResponseSchema).then((r) => r.categories),
    create: (input: CreateSaleCategoryInput): Promise<SaleCategory> =>
      requestJson("POST", "/api/sale-categories", input, saleCategorySchema),
    update: (id: number, changes: UpdateSaleCategoryInput): Promise<SaleCategory> =>
      requestJson("PATCH", `/api/sale-categories/${id}`, changes, saleCategorySchema),
    reorder: (ids: number[]): Promise<SaleCategory[]> =>
      requestJson(
        "PUT",
        "/api/sale-categories/order",
        { ids },
        saleCategoryListResponseSchema,
      ).then((r) => r.categories),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/sale-categories/${id}`, undefined),
  },

  /** FR-14: general-expense categories, in display order. */
  expenseCategories: {
    list: (): Promise<ExpenseCategory[]> =>
      getJson("/api/expense-categories", expenseCategoryListResponseSchema).then(
        (r) => r.categories,
      ),
    create: (input: CreateExpenseCategoryInput): Promise<ExpenseCategory> =>
      requestJson("POST", "/api/expense-categories", input, expenseCategorySchema),
    update: (id: number, changes: UpdateExpenseCategoryInput): Promise<ExpenseCategory> =>
      requestJson("PATCH", `/api/expense-categories/${id}`, changes, expenseCategorySchema),
    reorder: (ids: number[]): Promise<ExpenseCategory[]> =>
      requestJson(
        "PUT",
        "/api/expense-categories/order",
        { ids },
        expenseCategoryListResponseSchema,
      ).then((r) => r.categories),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/expense-categories/${id}`, undefined),
  },

  /** FR-15: payment methods (formas de pagamento), in display order. */
  paymentMethods: {
    list: (): Promise<PaymentMethod[]> =>
      getJson("/api/payment-methods", paymentMethodListResponseSchema).then(
        (r) => r.paymentMethods,
      ),
    create: (input: CreatePaymentMethodInput): Promise<PaymentMethod> =>
      requestJson("POST", "/api/payment-methods", input, paymentMethodSchema),
    update: (id: number, changes: UpdatePaymentMethodInput): Promise<PaymentMethod> =>
      requestJson("PATCH", `/api/payment-methods/${id}`, changes, paymentMethodSchema),
    reorder: (ids: number[]): Promise<PaymentMethod[]> =>
      requestJson(
        "PUT",
        "/api/payment-methods/order",
        { ids },
        paymentMethodListResponseSchema,
      ).then((r) => r.paymentMethods),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/payment-methods/${id}`, undefined),
  },

  /** FR-15: card machines (maquininhas), in display order. */
  cardMachines: {
    list: (): Promise<CardMachine[]> =>
      getJson("/api/card-machines", cardMachineListResponseSchema).then((r) => r.cardMachines),
    create: (input: CreateCardMachineInput): Promise<CardMachine> =>
      requestJson("POST", "/api/card-machines", input, cardMachineSchema),
    update: (id: number, changes: UpdateCardMachineInput): Promise<CardMachine> =>
      requestJson("PATCH", `/api/card-machines/${id}`, changes, cardMachineSchema),
    reorder: (ids: number[]): Promise<CardMachine[]> =>
      requestJson("PUT", "/api/card-machines/order", { ids }, cardMachineListResponseSchema).then(
        (r) => r.cardMachines,
      ),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/card-machines/${id}`, undefined),
  },

  /** FR-11: the month's fixed expenses ("contas do mês") and one-off entries. */
  fixedExpenses: {
    month: (month: string): Promise<MonthFixedExpensesResponse> =>
      getJson(`/api/fixed-expenses${toQueryString({ month })}`, monthFixedExpensesResponseSchema),
    createOneOff: (input: CreateOneOffFixedExpenseInput): Promise<FixedExpense> =>
      requestJson("POST", "/api/fixed-expenses", input, fixedExpenseSchema),
    /** FR-12 / FR-13: pays a pending bill (a loan counts one installment down). */
    pay: (id: number, input: PayFixedExpenseInput): Promise<FixedExpense> =>
      requestJson("POST", `/api/fixed-expenses/${id}/pay`, input, fixedExpenseSchema),
    /** FR-12: "não se aplica no mês": out of every total and alert. */
    dismiss: (id: number): Promise<FixedExpense> =>
      requestJson("POST", `/api/fixed-expenses/${id}/dismiss`, {}, fixedExpenseSchema),
    /** FR-12: back to pending ("Desfazer pagamento" / "Reativar"). */
    undo: (id: number): Promise<FixedExpense> =>
      requestJson("POST", `/api/fixed-expenses/${id}/undo`, {}, fixedExpenseSchema),
  },

  /** #13: the pilot's "CONTA:" sangrias, converted into paid fixed expenses. */
  contaConversions: {
    list: (): Promise<ContaCandidatesResponse> =>
      getJson("/api/conta-conversions", contaCandidatesResponseSchema),
    convert: (withdrawalId: number, input: ConvertContaInput): Promise<FixedExpense> =>
      requestJson("POST", `/api/conta-conversions/${withdrawalId}`, input, fixedExpenseSchema),
  },

  /** FR-10: fixed-expense templates (modelos), in display order. No delete. */
  fixedExpenseTemplates: {
    list: (): Promise<FixedExpenseTemplate[]> =>
      getJson("/api/fixed-expense-templates", fixedExpenseTemplateListResponseSchema).then(
        (r) => r.templates,
      ),
    create: (input: CreateFixedExpenseTemplateInput): Promise<FixedExpenseTemplate> =>
      requestJson("POST", "/api/fixed-expense-templates", input, fixedExpenseTemplateSchema),
    update: (id: number, changes: UpdateFixedExpenseTemplateInput): Promise<FixedExpenseTemplate> =>
      requestJson(
        "PATCH",
        `/api/fixed-expense-templates/${id}`,
        changes,
        fixedExpenseTemplateSchema,
      ),
    reorder: (ids: number[]): Promise<FixedExpenseTemplate[]> =>
      requestJson(
        "PUT",
        "/api/fixed-expense-templates/order",
        { ids },
        fixedExpenseTemplateListResponseSchema,
      ).then((r) => r.templates),
  },

  /** FR-15: the fee table; RN-01 lookup of the fee in force for a sale. */
  cardFees: {
    list: (): Promise<CardFee[]> =>
      getJson("/api/card-fees", cardFeeListResponseSchema).then((r) => r.fees),
    inForce: (query: CardFeeInForceQuery): Promise<CardFee | null> =>
      getJson(
        `/api/card-fees/in-force${toQueryString({ ...query })}`,
        cardFeeInForceResponseSchema,
      ).then((r) => r.fee),
    create: (input: CardFeeInput): Promise<CardFee> =>
      requestJson("POST", "/api/card-fees", input, cardFeeSchema),
    update: (id: number, input: CardFeeInput): Promise<CardFee> =>
      requestJson("PUT", `/api/card-fees/${id}`, input, cardFeeSchema),
    remove: (id: number): Promise<void> => requestJson("DELETE", `/api/card-fees/${id}`, undefined),
  },
};
