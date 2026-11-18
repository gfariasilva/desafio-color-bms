import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  cardFeeSchema,
  cardMachineListResponseSchema,
  paymentMethodListResponseSchema,
  saleCategoryListResponseSchema,
  saleSchema,
  type CardFeeInput,
  type CreateSaleInput,
  type Sale,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

/** 18/11/2026 at 15:00 in São Paulo (UTC−3). */
export const NOW = new Date("2026-11-18T18:00:00.000Z");
export const TODAY = "2026-11-18";

export interface SalesContext {
  app: FastifyInstance;
  connection: DatabaseConnection;
  ids: {
    toner: number;
    papelaria: number;
    chaveiro: number;
    pagSeguro: number;
    mercadoPago: number;
    cash: number;
    debit: number;
    credit: number;
    pix: number;
  };
  /** Tab id by name (the seeded RN-12 list). */
  tab: (name: string) => number;
}

/**
 * Shared setup of the sales tests (FR-03, FR-05): a fresh migrated database in a temp dir and
 * the app with a fixed clock. Call at the top level of a test file; read the context inside
 * the tests (it is refilled before each one).
 */
export function useSalesApp(): SalesContext {
  const context = {} as SalesContext;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-test-"));
    context.connection = openDatabase(path.join(tempDir, "test.db"));
    runMigrations(context.connection.db);
    context.app = await buildApp({ connection: context.connection, now: () => NOW });
    const app = context.app;

    const tabs = saleCategoryListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/sale-categories" })).json(),
    ).categories;
    const machines = cardMachineListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/card-machines" })).json(),
    ).cardMachines;
    const methods = paymentMethodListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/payment-methods" })).json(),
    ).paymentMethods;
    const tab = (name: string) => tabs.find((t) => t.name === name)!.id;
    const machine = (name: string) => machines.find((m) => m.name === name)!.id;
    const method = (name: string) => methods.find((m) => m.name === name)!.id;
    context.tab = tab;
    context.ids = {
      toner: tab("Toner"),
      papelaria: tab("Papelaria"),
      chaveiro: tab("Chaveiro"),
      pagSeguro: machine("PagSeguro"),
      mercadoPago: machine("Mercado Pago"),
      cash: method("Dinheiro"),
      debit: method("Cartão de débito"),
      credit: method("Cartão de crédito"),
      pix: method("PIX/Depósito"),
    };
  });

  afterEach(async () => {
    await context.app.close();
    context.connection.sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  return context;
}

export async function createFee(ctx: SalesContext, input: Partial<CardFeeInput> = {}) {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/card-fees",
    payload: {
      cardMachineId: ctx.ids.mercadoPago,
      paymentMethodId: ctx.ids.credit,
      installmentsFrom: 1,
      installmentsTo: 12,
      ratePpm: 37900,
      validFrom: "2026-01-01",
      ...input,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return cardFeeSchema.parse(response.json());
}

/** Registers a sale through POST /api/sales (a cash Toner sale of R$ 25,00 by default). */
export async function createSale(
  ctx: SalesContext,
  input: Partial<CreateSaleInput> = {},
): Promise<Sale> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/sales",
    payload: {
      date: TODAY,
      saleCategoryId: ctx.ids.toner,
      paymentMethodId: ctx.ids.cash,
      grossCents: 2500,
      ...input,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return saleSchema.parse(response.json());
}

export async function saleAudit(ctx: SalesContext) {
  const response = await ctx.app.inject({ method: "GET", url: "/api/audit?entity=sale" });
  return auditListResponseSchema.parse(response.json()).entries;
}

/** #9 will close days through the API; until then the tests write the row themselves. */
export function closeDay(ctx: SalesContext, date: string) {
  ctx.connection.sqlite
    .prepare("insert into days (date, status, closed_at) values (?, 'closed', ?)")
    .run(date, NOW.toISOString());
}

export function closeMonth(ctx: SalesContext, yearMonth: string) {
  ctx.connection.sqlite
    .prepare("insert into months (year_month, status, closed_at) values (?, 'closed', ?)")
    .run(yearMonth, NOW.toISOString());
}
