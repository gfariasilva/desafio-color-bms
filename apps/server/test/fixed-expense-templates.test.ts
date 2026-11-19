import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  fixedExpenseTemplateListResponseSchema,
  fixedExpenseTemplateNameKey,
  fixedExpenseTemplateSchema,
  INITIAL_FIXED_EXPENSE_TEMPLATES,
  type FixedExpenseTemplate,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

let tempDir: string;
let connection: DatabaseConnection;
let app: FastifyInstance;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-test-"));
  connection = openDatabase(path.join(tempDir, "test.db"));
  runMigrations(connection.db);
  app = await buildApp({ connection });
});

afterEach(async () => {
  await app.close();
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const URL = "/api/fixed-expense-templates";

const NEW_TEMPLATE = {
  name: "Internet",
  group: "general",
  subgroup: "Telefonia",
  dueDay: 15,
  expectedAmountCents: 9990,
  isLoan: false,
  installmentsTotal: null,
  installmentsRemaining: null,
};

async function list(query = ""): Promise<FixedExpenseTemplate[]> {
  const response = await app.inject({ method: "GET", url: `${URL}${query}` });
  expect(response.statusCode).toBe(200);
  return fixedExpenseTemplateListResponseSchema.parse(response.json()).templates;
}

async function templateId(name: string): Promise<number> {
  const found = (await list()).find((template) => template.name === name);
  if (!found) throw new Error(`no template ${name}`);
  return found.id;
}

async function patch(id: number, payload: object) {
  return app.inject({ method: "PATCH", url: `${URL}/${id}`, payload });
}

async function audit() {
  const response = await app.inject({ method: "GET", url: "/api/audit" });
  return auditListResponseSchema.parse(response.json()).entries;
}

function auditCount(): number {
  return connection.sqlite.prepare("select count(*) from audit_log").pluck().get() as number;
}

describe("RN-12: initial fixed-expense templates (seed migration)", () => {
  it("RN-12: seeds the 15 initial templates, active, in the FR-10 order", async () => {
    const templates = await list();
    expect(
      templates.map(({ name, group, subgroup, isLoan }) => ({ name, group, subgroup, isLoan })),
    ).toEqual(
      INITIAL_FIXED_EXPENSE_TEMPLATES.map((t) => ({
        name: t.name,
        group: t.group,
        subgroup: t.subgroup,
        isLoan: t.isLoan,
      })),
    );
    expect(templates.every((template) => template.active)).toBe(true);
    expect(templates.map((template) => template.order)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
  });

  it("RN-12: due days, amounts and loan installments are left to be filled in (Q-05, Q-06)", async () => {
    for (const template of await list()) {
      expect(template).toMatchObject({
        dueDay: null,
        expectedAmountCents: null,
        installmentsTotal: null,
        installmentsRemaining: null,
      });
    }
  });

  it("RN-12: seeded name keys match the core rule", () => {
    const rows = connection.sqlite
      .prepare("select name, subgroup, name_key from fixed_expense_templates")
      .all() as { name: string; subgroup: string | null; name_key: string }[];
    expect(rows).toHaveLength(15);
    for (const row of rows) {
      expect(row.name_key).toBe(fixedExpenseTemplateNameKey(row));
    }
  });

  it("RN-12: the seed writes no audit rows", () => {
    expect(auditCount()).toBe(0);
  });
});

describe("FR-10: create a template", () => {
  it("FR-10: creates a template and audits it", async () => {
    const response = await app.inject({ method: "POST", url: URL, payload: NEW_TEMPLATE });
    expect(response.statusCode, response.body).toBe(201);
    const created = fixedExpenseTemplateSchema.parse(response.json());
    // A new template goes to the end of its group's list (the display order is global).
    expect(created).toMatchObject({ ...NEW_TEMPLATE, order: 16, active: true });

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "fixed_expense_template",
      entityId: String(created.id),
      action: "create",
      before: null,
      after: {
        name: "Internet",
        templateGroup: "general",
        subgroup: "Telefonia",
        dueDay: 15,
        expectedAmountCents: 9990,
        isLoan: false,
        installmentsTotal: null,
        installmentsRemaining: null,
        order: 16,
        active: true,
      },
    });
  });

  it("FR-10: creates a loan with its total and remaining installments", async () => {
    const response = await app.inject({
      method: "POST",
      url: URL,
      payload: {
        ...NEW_TEMPLATE,
        name: "Empréstimo Banco do Brasil",
        subgroup: null,
        isLoan: true,
        installmentsTotal: 24,
        installmentsRemaining: 10,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      isLoan: true,
      installmentsTotal: 24,
      installmentsRemaining: 10,
    });
  });

  it("FR-10: rejects invalid fields with a pt-BR message", async () => {
    const cases: [object, string][] = [
      [{ dueDay: 32 }, "O dia de vencimento deve ser de 1 a 31."],
      [{ expectedAmountCents: 0 }, "Informe um valor previsto maior que zero."],
      [
        { isLoan: true, installmentsTotal: 10, installmentsRemaining: 11 },
        "As parcelas restantes não podem passar do total.",
      ],
      [{ installmentsTotal: 10, installmentsRemaining: 5 }, "Parcelas só valem para empréstimos."],
    ];
    for (const [change, message] of cases) {
      const response = await app.inject({
        method: "POST",
        url: URL,
        payload: { ...NEW_TEMPLATE, ...change },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: message });
    }
    expect(await list()).toHaveLength(15);
    expect(auditCount()).toBe(0);
  });

  it("FR-10: blocks a name already used, ignoring case and accents", async () => {
    for (const payload of [
      { ...NEW_TEMPLATE, name: "AGUA", subgroup: null },
      { ...NEW_TEMPLATE, name: "vivo FIXO", subgroup: "telefonia" },
    ]) {
      const response = await app.inject({ method: "POST", url: URL, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "Já existe um modelo de despesa fixa com esse nome.",
      });
    }
    expect(auditCount()).toBe(0);
  });

  it("FR-10: the same name in another subgroup is allowed", async () => {
    const response = await app.inject({
      method: "POST",
      url: URL,
      payload: { ...NEW_TEMPLATE, name: "Vivo fixo", subgroup: null },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe("FR-10: edit a template", () => {
  it("FR-10: edits a template and audits only what changed", async () => {
    const id = await templateId("Luz");
    const response = await patch(id, {
      name: "Luz",
      dueDay: 10,
      expectedAmountCents: 20000,
      subgroup: null,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(fixedExpenseTemplateSchema.parse(response.json())).toMatchObject({
      id,
      name: "Luz",
      dueDay: 10,
      expectedAmountCents: 20000,
      order: 2,
    });

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "fixed_expense_template",
      entityId: String(id),
      action: "update",
      before: { dueDay: null, expectedAmountCents: null },
      after: { dueDay: 10, expectedAmountCents: 20000 },
    });
    expect(auditCount()).toBe(1);
  });

  it("FR-10: an edit that changes nothing writes no audit row", async () => {
    const id = await templateId("Luz");
    const response = await patch(id, { name: "Luz", active: true });
    expect(response.statusCode).toBe(200);
    expect(auditCount()).toBe(0);
  });

  it("FR-10: fills in the installments of the seeded loan (Q-06)", async () => {
    const id = await templateId("Empréstimos");
    const response = await patch(id, { installmentsTotal: 10, installmentsRemaining: 10 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ installmentsTotal: 10, installmentsRemaining: 10 });
  });

  it("FR-10: checks the loan rules on the template after the edit", async () => {
    const id = await templateId("Empréstimos");
    await patch(id, { installmentsTotal: 10, installmentsRemaining: 10 });

    const tooMany = await patch(id, { installmentsRemaining: 11 });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toEqual({ error: "As parcelas restantes não podem passar do total." });

    const notALoan = await patch(id, { isLoan: false });
    expect(notALoan.statusCode).toBe(400);
    expect(notALoan.json()).toEqual({ error: "Parcelas só valem para empréstimos." });

    const stopsBeingALoan = await patch(id, {
      isLoan: false,
      installmentsTotal: null,
      installmentsRemaining: null,
    });
    expect(stopsBeingALoan.statusCode).toBe(200);
  });

  it("FR-10: blocks renaming to a name used by another template", async () => {
    const id = await templateId("Luz");
    const response = await patch(id, { name: "água" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Já existe um modelo de despesa fixa com esse nome.",
    });
  });

  it("FR-10: a template may keep its own name in another case", async () => {
    const id = await templateId("Luz");
    const response = await patch(id, { name: "LUZ" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "LUZ" });
  });

  it("FR-10: moving a template to the other group keeps it in its place", async () => {
    const id = await templateId("GPS");
    const response = await patch(id, { group: "government_fees" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ group: "government_fees", order: 6 });
    const [entry] = await audit();
    expect(entry).toMatchObject({
      before: { templateGroup: "general" },
      after: { templateGroup: "government_fees" },
    });
  });

  it("FR-10: an unknown template is 404 in pt-BR", async () => {
    for (const url of [`${URL}/9999`, `${URL}/abc`]) {
      const response = await app.inject({ method: "PATCH", url, payload: { active: false } });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Modelo de despesa fixa não encontrado." });
    }
  });
});

describe("FR-10: deactivate, reactivate and no delete", () => {
  it("FR-10: deactivates and reactivates a template", async () => {
    const id = await templateId("TFE");
    const off = await patch(id, { active: false });
    expect(off.json()).toMatchObject({ active: false });
    expect((await list("?active=true")).map((t) => t.name)).not.toContain("TFE");
    expect((await list("?active=false")).map((t) => t.name)).toEqual(["TFE"]);
    expect((await list()).find((t) => t.id === id)).toMatchObject({ active: false });

    const [entry] = await audit();
    expect(entry).toMatchObject({ before: { active: true }, after: { active: false } });

    const on = await patch(id, { active: true });
    expect(on.json()).toMatchObject({ active: true });
    expect((await list("?active=true")).map((t) => t.name)).toContain("TFE");
  });

  it("FR-10: templates cannot be deleted, only deactivated", async () => {
    const id = await templateId("TFE");
    const response = await app.inject({ method: "DELETE", url: `${URL}/${id}` });
    expect(response.statusCode).toBe(404);
    expect(await list()).toHaveLength(15);
  });

  // FR-10 "a deactivated template creates no entry when the next month is generated, and its
  // past entries stay" is tested with the month generation, in fixed-expenses.test.ts (#12).
});

describe("FR-10: reorder", () => {
  it("FR-10: reorders the templates and audits each one that moved", async () => {
    const ids = (await list()).map((template) => template.id);
    const dare = ids[12]!;
    const das = ids[11]!;
    const swapped = [...ids];
    swapped[11] = dare;
    swapped[12] = das;

    const response = await app.inject({
      method: "PUT",
      url: `${URL}/order`,
      payload: { ids: swapped },
    });
    expect(response.statusCode).toBe(200);
    const templates = fixedExpenseTemplateListResponseSchema.parse(response.json()).templates;
    expect(templates.slice(11, 13).map((t) => t.name)).toEqual(["DARE", "DAS"]);

    const entries = await audit();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.entity)).toEqual([
      "fixed_expense_template",
      "fixed_expense_template",
    ]);
  });

  it("FR-10: a stale order is rejected", async () => {
    const ids = (await list()).map((template) => template.id).slice(1);
    const response = await app.inject({ method: "PUT", url: `${URL}/order`, payload: { ids } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "A lista mudou. Atualize a página e tente de novo." });
  });
});
