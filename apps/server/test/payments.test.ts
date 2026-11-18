import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  cardMachineListResponseSchema,
  cardMachineSchema,
  CATEGORY_IN_USE_CODE,
  categoryNameKey,
  INITIAL_CARD_MACHINES,
  INITIAL_PAYMENT_METHODS,
  paymentMethodListResponseSchema,
  paymentMethodSchema,
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

const METHODS = "/api/payment-methods";
const MACHINES = "/api/card-machines";

async function listMethods(query = "") {
  const response = await app.inject({ method: "GET", url: `${METHODS}${query}` });
  expect(response.statusCode).toBe(200);
  return paymentMethodListResponseSchema.parse(response.json()).paymentMethods;
}

async function listMachines(query = "") {
  const response = await app.inject({ method: "GET", url: `${MACHINES}${query}` });
  expect(response.statusCode).toBe(200);
  return cardMachineListResponseSchema.parse(response.json()).cardMachines;
}

async function methodId(name: string) {
  const found = (await listMethods()).find((method) => method.name === name);
  if (!found) throw new Error(`no payment method ${name}`);
  return found.id;
}

async function machineId(name: string) {
  const found = (await listMachines()).find((machine) => machine.name === name);
  if (!found) throw new Error(`no card machine ${name}`);
  return found.id;
}

async function audit() {
  const response = await app.inject({ method: "GET", url: "/api/audit" });
  return auditListResponseSchema.parse(response.json()).entries;
}

function auditCount(): number {
  return connection.sqlite.prepare("select count(*) from audit_log").pluck().get() as number;
}

describe("RN-12: initial payment methods and card machines (seed migration)", () => {
  it("RN-12: seeds the 5 payment methods with their machine usage", async () => {
    const methods = await listMethods();
    expect(
      methods.map(({ name, machineUsage, allowsInstallments }) => ({
        name,
        machineUsage,
        allowsInstallments,
      })),
    ).toEqual(INITIAL_PAYMENT_METHODS);
    expect(methods.every((method) => method.active)).toBe(true);
    expect(methods.map((method) => method.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it("RN-12: seeds PagSeguro and Mercado Pago with no rates", async () => {
    const machines = await listMachines();
    expect(machines.map((machine) => machine.name)).toEqual([...INITIAL_CARD_MACHINES]);
    const fees = await app.inject({ method: "GET", url: "/api/card-fees" });
    expect(fees.json()).toEqual({ fees: [] });
  });

  it("RN-12: seeded name keys match the core rule", () => {
    for (const table of ["payment_methods", "card_machines"]) {
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

describe("FR-15: card machines follow the FR-14 rules", () => {
  it("FR-15: creates a machine at the end, active, with an audit row", async () => {
    const response = await app.inject({
      method: "POST",
      url: MACHINES,
      payload: { name: " Stone " },
    });
    expect(response.statusCode).toBe(201);
    const created = cardMachineSchema.parse(response.json());
    expect(created).toMatchObject({ name: "Stone", order: 3, active: true });

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "card_machine",
      entityId: String(created.id),
      action: "create",
      before: null,
      after: { name: "Stone", order: 3, active: true },
    });
  });

  it("FR-15: blocks a duplicate machine name, ignoring case and accents", async () => {
    const response = await app.inject({
      method: "POST",
      url: MACHINES,
      payload: { name: "PAGSEGURO" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Já existe uma maquininha com esse nome." });
    expect(auditCount()).toBe(0);
  });

  it("FR-15: renames and deactivates a machine, audited; inactive ones leave ?active=true", async () => {
    const id = await machineId("Mercado Pago");
    const response = await app.inject({
      method: "PATCH",
      url: `${MACHINES}/${id}`,
      payload: { name: "Mercado Pago Point", active: false },
    });
    expect(response.statusCode).toBe(200);
    expect((await listMachines("?active=true")).map((machine) => machine.name)).toEqual([
      "PagSeguro",
    ]);
    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "card_machine",
      action: "update",
      before: { name: "Mercado Pago", active: true },
      after: { name: "Mercado Pago Point", active: false },
    });
  });

  it("FR-15: reorders machines, auditing each one that moved", async () => {
    const ids = (await listMachines()).map((machine) => machine.id).reverse();
    const response = await app.inject({
      method: "PUT",
      url: `${MACHINES}/order`,
      payload: { ids },
    });
    expect(response.statusCode).toBe(200);
    expect((await listMachines()).map((machine) => machine.name)).toEqual([
      "Mercado Pago",
      "PagSeguro",
    ]);
    expect(auditCount()).toBe(2);
  });

  it("FR-15: deletes a machine never used, audited", async () => {
    const id = await machineId("Mercado Pago");
    const response = await app.inject({ method: "DELETE", url: `${MACHINES}/${id}` });
    expect(response.statusCode).toBe(204);
    expect((await listMachines()).map((machine) => machine.name)).toEqual(["PagSeguro"]);
    const [entry] = await audit();
    expect(entry).toMatchObject({ entity: "card_machine", action: "delete", after: null });
  });

  it("FR-15: blocks deleting a machine that has fee rows and offers to deactivate", async () => {
    const id = await machineId("PagSeguro");
    const fee = await app.inject({
      method: "POST",
      url: "/api/card-fees",
      payload: {
        cardMachineId: id,
        paymentMethodId: await methodId("Cartão de débito"),
        installmentsFrom: 1,
        installmentsTo: 1,
        ratePpm: 19900,
        validFrom: "2026-01-01",
      },
    });
    expect(fee.statusCode).toBe(201);
    const before = auditCount();

    const response = await app.inject({ method: "DELETE", url: `${MACHINES}/${id}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "Esta maquininha já tem taxas ou vendas e não pode ser excluída. Desative-a para que não apareça mais no lançamento de vendas.",
      code: CATEGORY_IN_USE_CODE,
    });
    expect(auditCount()).toBe(before);
  });

  it("FR-15: answers 404 for an unknown machine", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `${MACHINES}/999`,
      payload: { active: false },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Maquininha não encontrada." });
  });
});

describe("FR-15: payment methods follow the FR-14 rules", () => {
  it("FR-15: creates a payment method with its machine usage, audited", async () => {
    const response = await app.inject({
      method: "POST",
      url: METHODS,
      payload: { name: "Vale-presente", machineUsage: "not_applicable", allowsInstallments: false },
    });
    expect(response.statusCode).toBe(201);
    const created = paymentMethodSchema.parse(response.json());
    expect(created).toMatchObject({ name: "Vale-presente", order: 6, active: true });
    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "payment_method",
      action: "create",
      after: {
        name: "Vale-presente",
        machineUsage: "not_applicable",
        allowsInstallments: false,
        order: 6,
        active: true,
      },
    });
  });

  it("FR-15: blocks a duplicate payment method name, ignoring case and accents", async () => {
    const response = await app.inject({
      method: "POST",
      url: METHODS,
      payload: { name: "cartao de credito", machineUsage: "required", allowsInstallments: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Já existe uma forma de pagamento com esse nome." });
  });

  it("FR-15: changes machine usage and installments, auditing only what changed", async () => {
    const id = await methodId("PIX/Depósito");
    const response = await app.inject({
      method: "PATCH",
      url: `${METHODS}/${id}`,
      payload: { machineUsage: "not_applicable", allowsInstallments: false },
    });
    expect(response.statusCode).toBe(200);
    expect(paymentMethodSchema.parse(response.json()).machineUsage).toBe("not_applicable");
    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "payment_method",
      action: "update",
      before: { machineUsage: "optional" },
      after: { machineUsage: "not_applicable" },
    });
  });

  it("FR-15: a deactivated method is hidden from ?active=true", async () => {
    const id = await methodId("Boleto bancário");
    await app.inject({ method: "PATCH", url: `${METHODS}/${id}`, payload: { active: false } });
    expect((await listMethods("?active=true")).map((method) => method.name)).not.toContain(
      "Boleto bancário",
    );
    expect((await listMethods("?active=false")).map((method) => method.name)).toEqual([
      "Boleto bancário",
    ]);
  });

  it("FR-15: deletes an unused method and blocks one that has fee rows", async () => {
    const unused = await methodId("Boleto bancário");
    expect((await app.inject({ method: "DELETE", url: `${METHODS}/${unused}` })).statusCode).toBe(
      204,
    );

    const credit = await methodId("Cartão de crédito");
    await app.inject({
      method: "POST",
      url: "/api/card-fees",
      payload: {
        cardMachineId: await machineId("PagSeguro"),
        paymentMethodId: credit,
        installmentsFrom: 1,
        installmentsTo: 1,
        ratePpm: 37900,
        validFrom: "2026-01-01",
      },
    });
    const response = await app.inject({ method: "DELETE", url: `${METHODS}/${credit}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: CATEGORY_IN_USE_CODE });
  });

  it("FR-15: rejects an unknown machine usage with a pt-BR message", async () => {
    const id = await methodId("Dinheiro");
    const response = await app.inject({
      method: "PATCH",
      url: `${METHODS}/${id}`,
      payload: { machineUsage: "x" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Uso da maquininha inválido." });
  });

  it.todo("FR-15: blocks deleting a machine or method used by sales (#4)");
});
