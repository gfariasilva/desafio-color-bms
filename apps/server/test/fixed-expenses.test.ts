import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  auditListResponseSchema,
  FIXED_EXPENSE_TEXTS,
  fixedExpenseSchema,
  fixedExpenseTemplateListResponseSchema,
  INITIAL_FIXED_EXPENSE_TEMPLATES,
  monthFixedExpensesResponseSchema,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { expenses, months } from "../src/db/schema";

/**
 * FR-11: generating the month's fixed expenses and adding one-off entries. The clock is
 * mutable so a test can move into the next month while the same app keeps running.
 */

/** 18/11/2026 at 15:00 in São Paulo (UTC−3). */
const NOV_18 = "2026-11-18T18:00:00.000Z";

let tempDir: string;
let connection: DatabaseConnection;
let app: FastifyInstance;
let now: Date;

async function start(): Promise<void> {
  app = await buildApp({ connection, now: () => now });
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-test-"));
  connection = openDatabase(path.join(tempDir, "test.db"));
  runMigrations(connection.db);
  now = new Date(NOV_18);
  await start();
});

afterEach(async () => {
  await app.close();
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function getMonth(month?: string) {
  const response = await app.inject({
    method: "GET",
    url: month ? `/api/fixed-expenses?month=${month}` : "/api/fixed-expenses",
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthFixedExpensesResponseSchema.parse(response.json());
}

async function templateId(name: string): Promise<number> {
  const response = await app.inject({ method: "GET", url: "/api/fixed-expense-templates" });
  const found = fixedExpenseTemplateListResponseSchema
    .parse(response.json())
    .templates.find((template) => template.name === name);
  if (!found) throw new Error(`no template ${name}`);
  return found.id;
}

async function patchTemplate(name: string, payload: object) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/fixed-expense-templates/${await templateId(name)}`,
    payload,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { active: boolean };
}

async function audit(query: string) {
  const response = await app.inject({ method: "GET", url: `/api/audit?${query}` });
  return auditListResponseSchema.parse(response.json()).entries;
}

function fixedRowsOf(month: string) {
  return connection.db.select().from(expenses).where(eq(expenses.referenceMonth, month)).all();
}

/** Moves the clock and makes one request, as when the owner opens a screen. */
async function openAt(instant: string): Promise<void> {
  now = new Date(instant);
  const response = await app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
}

const ONE_OFF = {
  referenceMonth: "2026-11",
  description: "IPTU",
  group: "government_fees",
  dueDate: "2026-11-25",
  expectedAmountCents: 15000,
};

describe("FR-11: generate the month's fixed expenses", () => {
  it("FR-11: generates one pending entry per active template when the system opens in the month", async () => {
    const month = await getMonth();
    expect(month.month).toBe("2026-11");
    expect(month.currentMonth).toBe("2026-11");
    expect(month.generated).toBe(true);
    expect(month.expenses).toHaveLength(INITIAL_FIXED_EXPENSE_TEMPLATES.length);
    for (const entry of month.expenses) {
      expect(entry).toMatchObject({
        referenceMonth: "2026-11",
        status: "pending",
        oneOff: false,
        amountCents: null,
        paymentDate: null,
      });
      expect(entry.fixedExpenseTemplateId).not.toBeNull();
    }
    expect(month.expenses.map((entry) => entry.label)).toContain("Telefonia – Vivo fixo");
    // Q-05: the seeded templates have no due day or amount yet ("Sem vencimento" in the UI).
    expect(month.expenses.every((entry) => entry.dueDate === null)).toBe(true);

    const row = connection.db.select().from(months).where(eq(months.yearMonth, "2026-11")).get();
    expect(row).toMatchObject({ status: "open", fixedExpensesGenerated: true });
  });

  it("FR-11: uses the configured due day (or the month's last day) and the expected amount", async () => {
    await patchTemplate("Luz", { dueDay: 31, expectedAmountCents: 20000 });
    await patchTemplate("Água", { dueDay: 10 });
    await openAt("2027-02-05T15:00:00.000Z");

    const february = await getMonth("2027-02");
    const luz = february.expenses.find((entry) => entry.label === "Luz");
    const agua = february.expenses.find((entry) => entry.label === "Água");
    expect(luz).toMatchObject({ dueDate: "2027-02-28", expectedAmountCents: 20000 });
    expect(agua).toMatchObject({ dueDate: "2027-02-10", expectedAmountCents: null });
    expect(february.expectedTotalCents).toBe(20000);
  });

  it("FR-11: lists by group (Gerais, then Taxas governo), then due date, entries without due date last", async () => {
    await patchTemplate("DAS", { dueDay: 20 });
    await patchTemplate("Luz", { dueDay: 15 });
    await patchTemplate("Aluguel", { dueDay: 5 });
    await openAt("2026-12-02T15:00:00.000Z");

    const labels = (await getMonth("2026-12")).expenses.map((entry) => entry.label);
    expect(labels.slice(0, 2)).toEqual(["Aluguel", "Luz"]);
    const firstFee = labels.indexOf("DAS");
    expect(
      labels.slice(0, firstFee).every((label) => !["DARE", "DARF", "TFE"].includes(label)),
    ).toBe(true);
  });

  it("FR-11: opening the system again duplicates nothing", async () => {
    await getMonth();
    await getMonth();
    await app.close();
    await start(); // a restart: generation runs again at startup
    await getMonth();

    expect(fixedRowsOf("2026-11")).toHaveLength(INITIAL_FIXED_EXPENSE_TEMPLATES.length);
  });

  it("FR-11: the database refuses a second entry of the same template in the same month", async () => {
    const [first] = fixedRowsOf("2026-11");
    const { id: _id, ...copy } = first!;
    expect(() => connection.db.insert(expenses).values(copy).run()).toThrow(/UNIQUE/);
  });

  it("FR-11: generates the new month on the first request after midnight, while running", async () => {
    await openAt("2026-12-01T02:59:00.000Z"); // 30/11 23:59 in São Paulo
    expect(fixedRowsOf("2026-12")).toHaveLength(0);

    await openAt("2026-12-01T03:00:00.000Z"); // 01/12 00:00 in São Paulo
    expect(fixedRowsOf("2026-12")).toHaveLength(INITIAL_FIXED_EXPENSE_TEMPLATES.length);
    expect(fixedRowsOf("2026-11")).toHaveLength(INITIAL_FIXED_EXPENSE_TEMPLATES.length);
  });

  it("FR-11: a loan with 0 installments left creates no entry and is deactivated automatically", async () => {
    await patchTemplate("Empréstimos", { installmentsTotal: 10, installmentsRemaining: 0 });
    await openAt("2026-12-02T15:00:00.000Z");

    const december = await getMonth("2026-12");
    expect(december.expenses.map((entry) => entry.label)).not.toContain("Empréstimos");
    expect(december.expenses).toHaveLength(INITIAL_FIXED_EXPENSE_TEMPLATES.length - 1);

    const template = fixedExpenseTemplateListResponseSchema
      .parse((await app.inject({ method: "GET", url: "/api/fixed-expense-templates" })).json())
      .templates.find((item) => item.name === "Empréstimos");
    expect(template?.active).toBe(false);

    const [entry] = await audit("entity=fixed_expense_template&action=update");
    expect(entry).toMatchObject({
      entityId: String(template?.id),
      before: { active: true },
      after: { active: false },
      reason: FIXED_EXPENSE_TEXTS.loanFinishedReason,
    });
  });

  it("FR-13: a loan with installments left gets 'parcela n de N'", async () => {
    await patchTemplate("Empréstimos", { installmentsTotal: 12, installmentsRemaining: 10 });
    await openAt("2026-12-02T15:00:00.000Z");

    const loan = (await getMonth("2026-12")).expenses.find(
      (entry) => entry.label === "Empréstimos",
    );
    expect(loan).toMatchObject({ installmentNumber: 3, installmentsTotal: 12 });
  });

  it("FR-10: a deactivated template creates no entry when the next month is generated, and its past entries stay", async () => {
    await getMonth();
    await patchTemplate("Luz", { active: false });
    await openAt("2026-12-02T15:00:00.000Z");

    expect((await getMonth("2026-12")).expenses.map((entry) => entry.label)).not.toContain("Luz");
    expect((await getMonth("2026-11")).expenses.map((entry) => entry.label)).toContain("Luz");
  });

  it("RN-14: a closed month is not generated", async () => {
    connection.db
      .insert(months)
      .values({ yearMonth: "2026-12", status: "closed", closedAt: NOV_18 })
      .run();
    await openAt("2026-12-02T15:00:00.000Z");

    expect(fixedRowsOf("2026-12")).toHaveLength(0);
    expect((await getMonth("2026-12")).generated).toBe(false);
  });

  it("FR-11: generation writes no expense audit rows (it is automatic)", async () => {
    await getMonth();
    expect(await audit("entity=expense")).toHaveLength(0);
  });

  it("FR-06: pending fixed entries do not show among the day's general expenses", async () => {
    const response = await app.inject({ method: "GET", url: "/api/days/2026-11-18/expenses" });
    expect(response.json()).toMatchObject({ expenses: [], totalCents: 0 });
  });

  it("FR-11: a month never generated (before the system was installed) is listed empty", async () => {
    const october = await getMonth("2026-10");
    expect(october).toMatchObject({ generated: false, expenses: [], expectedTotalCents: 0 });
  });

  it("FR-11: rejects an invalid month", async () => {
    const response = await app.inject({ method: "GET", url: "/api/fixed-expenses?month=2026-13" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: FIXED_EXPENSE_TEXTS.invalidMonth });
  });
});

describe("FR-11: one-off fixed entries", () => {
  async function postOneOff(payload: object) {
    return app.inject({ method: "POST", url: "/api/fixed-expenses", payload });
  }

  it("FR-11: the owner adds a one-off fixed entry to the month, with an audit row", async () => {
    const response = await postOneOff(ONE_OFF);
    expect(response.statusCode, response.body).toBe(201);
    const created = fixedExpenseSchema.parse(response.json());
    expect(created).toMatchObject({
      referenceMonth: "2026-11",
      label: "IPTU",
      group: "government_fees",
      dueDate: "2026-11-25",
      expectedAmountCents: 15000,
      status: "pending",
      oneOff: true,
      fixedExpenseTemplateId: null,
    });

    const month = await getMonth();
    expect(month.expenses.find((entry) => entry.id === created.id)).toEqual(created);
    expect(month.expenses).toHaveLength(INITIAL_FIXED_EXPENSE_TEMPLATES.length + 1);

    const [entry] = await audit("entity=expense");
    expect(entry).toMatchObject({
      entityId: String(created.id),
      action: "create",
      before: null,
      after: {
        expenseType: "fixed",
        referenceMonth: "2026-11",
        description: "IPTU",
        templateGroup: "government_fees",
        dueDate: "2026-11-25",
        expectedAmountCents: 15000,
        expenseStatus: "pending",
      },
    });
  });

  it("FR-11: a one-off entry may go in a past month and have a future due date (RN-15)", async () => {
    const response = await postOneOff({
      ...ONE_OFF,
      referenceMonth: "2026-10",
      dueDate: "2027-01-10",
    });
    expect(response.statusCode, response.body).toBe(201);
    expect((await getMonth("2026-10")).expenses).toHaveLength(1);
  });

  it("RN-15: a one-off entry cannot go in a future month", async () => {
    const response = await postOneOff({ ...ONE_OFF, referenceMonth: "2026-12" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: FIXED_EXPENSE_TEXTS.futureMonth });
  });

  it("RN-14: a one-off entry cannot go in a closed month", async () => {
    connection.db
      .insert(months)
      .values({ yearMonth: "2026-10", status: "closed", closedAt: NOV_18 })
      .run();
    const response = await postOneOff({ ...ONE_OFF, referenceMonth: "2026-10" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe(
      "O mês 10/2026 está fechado. Reabra o mês para adicionar contas nele.",
    );
    expect((await getMonth("2026-10")).lock).toBe(response.json().error);
    expect(await audit("entity=expense")).toHaveLength(0);
  });

  it("FR-11: validates the one-off entry with pt-BR messages", async () => {
    const response = await postOneOff({ ...ONE_OFF, description: " " });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: FIXED_EXPENSE_TEXTS.nameRequired });
  });
});
