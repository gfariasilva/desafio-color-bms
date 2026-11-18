import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  categoryNameKey,
  CATEGORY_IN_USE_CODE,
  expenseCategoryListResponseSchema,
  expenseCategorySchema,
  INITIAL_EXPENSE_CATEGORIES,
  INITIAL_SALE_CATEGORIES,
  saleCategoryListResponseSchema,
  saleCategorySchema,
  paymentMethodListResponseSchema,
  saleListResponseSchema,
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

const SALE = "/api/sale-categories";
const EXPENSE = "/api/expense-categories";

async function listSale(query = "") {
  const response = await app.inject({ method: "GET", url: `${SALE}${query}` });
  expect(response.statusCode).toBe(200);
  return saleCategoryListResponseSchema.parse(response.json()).categories;
}

async function listExpense(query = "") {
  const response = await app.inject({ method: "GET", url: `${EXPENSE}${query}` });
  expect(response.statusCode).toBe(200);
  return expenseCategoryListResponseSchema.parse(response.json()).categories;
}

/** A past date, so the real clock never makes it a future date (RN-15). */
const SALE_DATE = "2026-01-10";

/** FR-01: a cash sale in the tab, through the public API. */
async function registerCashSale(saleCategoryId: number, grossCents: number) {
  const methods = paymentMethodListResponseSchema.parse(
    (await app.inject({ method: "GET", url: "/api/payment-methods" })).json(),
  ).paymentMethods;
  const response = await app.inject({
    method: "POST",
    url: "/api/sales",
    payload: {
      date: SALE_DATE,
      saleCategoryId,
      paymentMethodId: methods.find((method) => method.name === "Dinheiro")!.id,
      grossCents,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function saleId(name: string): Promise<number> {
  const found = (await listSale()).find((category) => category.name === name);
  if (!found) throw new Error(`no sale category ${name}`);
  return found.id;
}

async function audit() {
  const response = await app.inject({ method: "GET", url: "/api/audit" });
  return auditListResponseSchema.parse(response.json()).entries;
}

function auditCount(): number {
  return connection.sqlite.prepare("select count(*) from audit_log").pluck().get() as number;
}

describe("RN-12: initial lists (seed migration)", () => {
  it("RN-12: seeds the 9 sale tabs, active, in the spec order", async () => {
    const categories = await listSale();
    expect(categories.map((category) => category.name)).toEqual([...INITIAL_SALE_CATEGORIES]);
    expect(categories.every((category) => category.active)).toBe(true);
    expect(categories.map((category) => category.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("RN-12: seeds the expense categories with the Fornecedores de materiais group", async () => {
    const categories = await listExpense();
    expect(categories.map(({ name, group }) => ({ name, group }))).toEqual(
      INITIAL_EXPENSE_CATEGORIES,
    );
    expect(categories.every((category) => category.active)).toBe(true);
  });

  it("RN-12: seeded name keys match the core rule", () => {
    for (const table of ["sale_categories", "expense_categories"]) {
      const rows = connection.sqlite.prepare(`select name, name_key from ${table}`).all() as {
        name: string;
        name_key: string;
      }[];
      for (const row of rows) expect(row.name_key).toBe(categoryNameKey(row.name));
    }
  });

  it("RN-12: the seed writes no audit rows", () => {
    expect(auditCount()).toBe(0);
  });
});

describe("FR-14: sale tabs", () => {
  it("FR-14: creates a tab at the end, active, with an audit row", async () => {
    const response = await app.inject({
      method: "POST",
      url: SALE,
      payload: { name: "  Encadernação  " },
    });
    expect(response.statusCode).toBe(201);
    const created = saleCategorySchema.parse(response.json());
    expect(created).toMatchObject({ name: "Encadernação", order: 10, active: true });

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "sale_category",
      entityId: String(created.id),
      action: "create",
      before: null,
      after: { name: "Encadernação", order: 10, active: true },
    });
  });

  it("FR-14: blocks creating a name already used, ignoring case and accents", async () => {
    for (const name of ["TONER", "servicos de copiadora", "  Serviços  de COPIADORA "]) {
      const response = await app.inject({ method: "POST", url: SALE, payload: { name } });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "Já existe uma aba com esse nome." });
    }
    expect(await listSale()).toHaveLength(9);
    expect(auditCount()).toBe(0);
  });

  it("FR-14: rejects an empty name with a pt-BR message", async () => {
    const response = await app.inject({ method: "POST", url: SALE, payload: { name: " " } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Informe o nome." });
  });

  it("FR-14: renaming keeps the id, so every sale follows the new name", async () => {
    const id = await saleId("Serviços de copiadora");
    const response = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { name: "Cópias e impressões" },
    });
    expect(response.statusCode).toBe(200);
    expect(saleCategorySchema.parse(response.json())).toMatchObject({
      id,
      name: "Cópias e impressões",
      order: 8,
    });
    // Sales reference the tab by id (spec §6.3); #4 adds the check with real sales.
    expect((await listSale()).find((category) => category.id === id)?.name).toBe(
      "Cópias e impressões",
    );

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "sale_category",
      entityId: String(id),
      action: "update",
      before: { name: "Serviços de copiadora" },
      after: { name: "Cópias e impressões" },
    });
  });

  it("FR-14: blocks renaming to a name used by another tab of the same type", async () => {
    const id = await saleId("Toner");
    const response = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { name: "PAPELARIA" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Já existe uma aba com esse nome." });
    expect(auditCount()).toBe(0);
  });

  it("FR-14: renaming a tab to its own name in another case is allowed", async () => {
    const id = await saleId("Toner");
    const response = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { name: "TONER" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "TONER" });
  });

  it("FR-14: a deactivated tab is hidden from entry lists but kept in the full list", async () => {
    const id = await saleId("Recargas");
    const response = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { active: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: false });

    expect((await listSale("?active=true")).map((category) => category.name)).not.toContain(
      "Recargas",
    );
    expect((await listSale()).find((category) => category.id === id)).toMatchObject({
      name: "Recargas",
      active: false,
    });

    const [entry] = await audit();
    expect(entry).toMatchObject({
      action: "update",
      before: { active: true },
      after: { active: false },
    });
  });

  it("FR-14: reactivates a tab", async () => {
    const id = await saleId("Recargas");
    await app.inject({ method: "PATCH", url: `${SALE}/${id}`, payload: { active: false } });
    const response = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { active: true },
    });
    expect(response.json()).toMatchObject({ active: true });
    expect((await listSale("?active=true")).map((category) => category.name)).toContain("Recargas");
  });

  it("FR-14: an update that changes nothing writes no audit row", async () => {
    const id = await saleId("Toner");
    const response = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { name: "Toner", active: true },
    });
    expect(response.statusCode).toBe(200);
    expect(auditCount()).toBe(0);
  });

  it("FR-14: reorders the tabs and audits each one that moved", async () => {
    const before = await listSale();
    const ids = before.map((category) => category.id);
    const swapped = [ids[1], ids[0], ...ids.slice(2)] as number[];

    const response = await app.inject({
      method: "PUT",
      url: `${SALE}/order`,
      payload: { ids: swapped },
    });
    expect(response.statusCode).toBe(200);
    const after = saleCategoryListResponseSchema.parse(response.json()).categories;
    expect(after.map((category) => category.name).slice(0, 2)).toEqual(["Carimbos", "Acessórios"]);
    expect(after.map((category) => category.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const entries = await audit();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.entityId, entry.before, entry.after])).toEqual(
      expect.arrayContaining([
        [String(ids[0]), { order: 1 }, { order: 2 }],
        [String(ids[1]), { order: 2 }, { order: 1 }],
      ]),
    );
  });

  it("FR-14: a reorder must list exactly the current tabs", async () => {
    const ids = (await listSale()).map((category) => category.id);
    for (const payload of [{ ids: ids.slice(1) }, { ids: [...ids.slice(1), 999] }]) {
      const response = await app.inject({ method: "PUT", url: `${SALE}/order`, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "A lista mudou. Atualize a página e tente de novo.",
      });
    }
    expect(auditCount()).toBe(0);
  });

  it("FR-14: deletes a never-used tab and audits it", async () => {
    const id = await saleId("Personalizados");
    const response = await app.inject({ method: "DELETE", url: `${SALE}/${id}` });
    expect(response.statusCode).toBe(204);
    expect((await listSale()).map((category) => category.name)).not.toContain("Personalizados");

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "sale_category",
      entityId: String(id),
      action: "delete",
      before: { name: "Personalizados", order: 9, active: true },
      after: null,
    });
  });

  it("FR-14: a delete closes the gap, so the next move audits only the two swapped tabs", async () => {
    await app.inject({ method: "DELETE", url: `${SALE}/${await saleId("Recargas")}` });
    expect((await listSale()).map((category) => category.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const ids = (await listSale()).map((category) => category.id);
    const lastTwoSwapped = [...ids.slice(0, -2), ids[7], ids[6]] as number[];
    await app.inject({ method: "PUT", url: `${SALE}/order`, payload: { ids: lastTwoSwapped } });

    const orderChanges = (await audit()).filter((entry) => entry.action === "update");
    expect(orderChanges).toHaveLength(2);
  });

  it("FR-14: ?active=false lists only the deactivated tabs", async () => {
    await app.inject({
      method: "PATCH",
      url: `${SALE}/${await saleId("Recargas")}`,
      payload: { active: false },
    });
    expect((await listSale("?active=false")).map((category) => category.name)).toEqual([
      "Recargas",
    ]);
  });

  it("FR-14: a malformed body gets a pt-BR message", async () => {
    const id = await saleId("Toner");
    const wrongType = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { active: "sim" },
    });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json()).toEqual({ error: "Situação inválida: use verdadeiro ou falso." });

    const noBody = await app.inject({ method: "POST", url: SALE });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json()).toEqual({ error: "Dados inválidos." });
  });

  it(`FR-14: blocks deleting a tab with sales and answers ${CATEGORY_IN_USE_CODE}`, async () => {
    const id = await saleId("Toner");
    await registerCashSale(id, 2500);

    const response = await app.inject({ method: "DELETE", url: `${SALE}/${id}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: CATEGORY_IN_USE_CODE });
    expect((await listSale()).some((category) => category.id === id)).toBe(true);
  });

  it("FR-14: after renaming a tab, old sales show the new name and their totals do not change", async () => {
    const id = await saleId("Serviços de copiadora");
    await registerCashSale(id, 1050);
    await registerCashSale(id, 2000);

    const rename = await app.inject({
      method: "PATCH",
      url: `${SALE}/${id}`,
      payload: { name: "Cópias e impressões" },
    });
    expect(rename.statusCode, rename.body).toBe(200);

    const sales = saleListResponseSchema.parse(
      (await app.inject({ method: "GET", url: `/api/sales?date=${SALE_DATE}` })).json(),
    ).sales;
    expect(sales.map((sale) => sale.saleCategoryName)).toEqual([
      "Cópias e impressões",
      "Cópias e impressões",
    ]);
    expect(sales.reduce((total, sale) => total + sale.grossCents, 0)).toBe(3050);
  });

  it("FR-14: answers 404 for an unknown tab", async () => {
    for (const request of [
      { method: "PATCH", url: `${SALE}/999`, payload: { active: false } },
      { method: "DELETE", url: `${SALE}/999` },
    ] as const) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Aba não encontrada." });
    }
  });

  it("FR-14: a name freed by a deleted tab can be used again", async () => {
    const id = await saleId("Personalizados");
    await app.inject({ method: "DELETE", url: `${SALE}/${id}` });
    const response = await app.inject({
      method: "POST",
      url: SALE,
      payload: { name: "personalizados" },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe("FR-14: expense categories", () => {
  it("FR-14: the same name can exist as a sale tab and as an expense category", async () => {
    expect((await listSale()).map((category) => category.name)).toContain("Acessórios");
    expect((await listExpense()).map((category) => category.name)).toContain("Acessórios");
  });

  it("FR-14: creates a supplier category at the end with an audit row", async () => {
    const response = await app.inject({
      method: "POST",
      url: EXPENSE,
      payload: { name: "Tilibra", group: "suppliers" },
    });
    expect(response.statusCode).toBe(201);
    const created = expenseCategorySchema.parse(response.json());
    expect(created).toMatchObject({ name: "Tilibra", group: "suppliers", order: 16, active: true });

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "expense_category",
      action: "create",
      after: { name: "Tilibra", group: "suppliers", order: 16, active: true },
    });
  });

  it("FR-14: blocks a duplicate expense category name, ignoring case and accents", async () => {
    const response = await app.inject({
      method: "POST",
      url: EXPENSE,
      payload: { name: "alimentacao", group: "general" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Já existe uma categoria de despesa com esse nome." });
  });

  it("FR-14: rejects an unknown group", async () => {
    const response = await app.inject({
      method: "POST",
      url: EXPENSE,
      payload: { name: "Tilibra", group: "outro" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Grupo inválido." });
  });

  it("FR-14: moves a category to another group, audited", async () => {
    const kalunga = (await listExpense()).find((category) => category.name === "Kalunga");
    const response = await app.inject({
      method: "PATCH",
      url: `${EXPENSE}/${kalunga?.id}`,
      payload: { group: "general" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "Kalunga", group: "general" });
    const [entry] = await audit();
    expect(entry).toMatchObject({ before: { group: "suppliers" }, after: { group: "general" } });
  });

  it("FR-14: a deactivated expense category is hidden from entry lists", async () => {
    const diversos = (await listExpense()).find((category) => category.name === "Diversos");
    await app.inject({
      method: "PATCH",
      url: `${EXPENSE}/${diversos?.id}`,
      payload: { active: false },
    });
    expect((await listExpense("?active=true")).map((category) => category.name)).not.toContain(
      "Diversos",
    );
    expect((await listExpense()).map((category) => category.name)).toContain("Diversos");
  });

  it("FR-14: answers 404 for an unknown expense category", async () => {
    const response = await app.inject({ method: "DELETE", url: `${EXPENSE}/999` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Categoria de despesa não encontrada." });
  });

  it.todo(`FR-14: blocks deleting an expense category with expenses (${CATEGORY_IN_USE_CODE}, #7)`);
});
