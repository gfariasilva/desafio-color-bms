import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  CARD_FEE_MISSING_CODE,
  cardFeeSchema,
  cardMachineListResponseSchema,
  DAY_CLOSED_CODE,
  paymentMethodListResponseSchema,
  saleCategoryListResponseSchema,
  saleListResponseSchema,
  saleSchema,
  todayResponseSchema,
  type CardFeeInput,
  type CreateSaleInput,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

/** 18/11/2026 at 15:00 in São Paulo (UTC−3). */
const NOW = new Date("2026-11-18T18:00:00.000Z");

let tempDir: string;
let connection: DatabaseConnection;
let app: FastifyInstance;
let ids: {
  toner: number;
  papelaria: number;
  pagSeguro: number;
  mercadoPago: number;
  cash: number;
  debit: number;
  credit: number;
  pix: number;
};

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-test-"));
  connection = openDatabase(path.join(tempDir, "test.db"));
  runMigrations(connection.db);
  app = await buildApp({ connection, now: () => NOW });

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
  ids = {
    toner: tab("Toner"),
    papelaria: tab("Papelaria"),
    pagSeguro: machine("PagSeguro"),
    mercadoPago: machine("Mercado Pago"),
    cash: method("Dinheiro"),
    debit: method("Cartão de débito"),
    credit: method("Cartão de crédito"),
    pix: method("PIX/Depósito"),
  };
});

afterEach(async () => {
  await app.close();
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const SALES = "/api/sales";

async function createFee(input: Partial<CardFeeInput> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/card-fees",
    payload: {
      cardMachineId: ids.mercadoPago,
      paymentMethodId: ids.credit,
      installmentsFrom: 2,
      installmentsTo: 6,
      ratePpm: 37900,
      validFrom: "2026-01-01",
      ...input,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return cardFeeSchema.parse(response.json());
}

function cashSale(input: Partial<CreateSaleInput> = {}): CreateSaleInput {
  return {
    date: "2026-11-18",
    saleCategoryId: ids.toner,
    paymentMethodId: ids.cash,
    grossCents: 2500,
    ...input,
  };
}

function post(payload: unknown) {
  return app.inject({ method: "POST", url: SALES, payload: payload as object });
}

async function listSales(date: string) {
  const response = await app.inject({ method: "GET", url: `${SALES}?date=${date}` });
  expect(response.statusCode, response.body).toBe(200);
  return saleListResponseSchema.parse(response.json()).sales;
}

async function audit() {
  const response = await app.inject({ method: "GET", url: "/api/audit?entity=sale" });
  return auditListResponseSchema.parse(response.json()).entries;
}

function salesCount(): number {
  return connection.sqlite.prepare("select count(*) from sales").pluck().get() as number;
}

function closeDay(date: string) {
  // #9 will close days through the API; until then the test writes the row itself.
  connection.sqlite
    .prepare("insert into days (date, status, closed_at) values (?, 'closed', ?)")
    .run(date, NOW.toISOString());
}

function closeMonth(yearMonth: string) {
  connection.sqlite
    .prepare("insert into months (year_month, status, closed_at) values (?, 'closed', ?)")
    .run(yearMonth, NOW.toISOString());
}

describe("GET /api/today (RN-15)", () => {
  it("RN-15: answers today's civil date in São Paulo from the server clock", async () => {
    const response = await app.inject({ method: "GET", url: "/api/today" });
    expect(todayResponseSchema.parse(response.json())).toEqual({ date: "2026-11-18" });
  });

  it("RN-15: after 21:00 in São Paulo it is still the same day (UTC is already tomorrow)", async () => {
    await app.close();
    app = await buildApp({ connection, now: () => new Date("2026-11-19T02:59:00Z") });
    const response = await app.inject({ method: "GET", url: "/api/today" });
    expect(response.json()).toEqual({ date: "2026-11-18" });
  });
});

describe("FR-01: register a sale", () => {
  it("FR-01: saves a R$ 150,00 Toner sale on Crédito, Mercado Pago, 3x with the fee in force (RN-01 to RN-03)", async () => {
    await createFee({ ratePpm: 37900 });

    const response = await post({
      date: "2026-11-18",
      saleCategoryId: ids.toner,
      paymentMethodId: ids.credit,
      cardMachineId: ids.mercadoPago,
      installments: 3,
      grossCents: 15000,
    });
    expect(response.statusCode, response.body).toBe(201);
    const sale = saleSchema.parse(response.json());
    expect(sale).toMatchObject({
      date: "2026-11-18",
      type: "sale",
      createdAt: NOW.toISOString(),
      saleCategoryId: ids.toner,
      saleCategoryName: "Toner",
      paymentMethodName: "Cartão de crédito",
      cardMachineName: "Mercado Pago",
      installments: 3,
      grossCents: 15000,
      feeRatePpm: 37900,
      feeCents: 569,
      netCents: 14431,
      note: null,
    });

    // …and it appears under "Toner" on that day.
    const sales = await listSales("2026-11-18");
    expect(sales).toEqual([sale]);
    expect(await listSales("2026-11-17")).toEqual([]);
  });

  it("FR-18: records the creation in the audit log, with names and money in cents", async () => {
    await createFee({ ratePpm: 37900 });
    const sale = saleSchema.parse(
      (
        await post({
          date: "2026-11-18",
          saleCategoryId: ids.toner,
          paymentMethodId: ids.credit,
          cardMachineId: ids.mercadoPago,
          installments: 3,
          grossCents: 15000,
          note: "cliente da gráfica",
        })
      ).json(),
    );

    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "sale",
      entityId: String(sale.id),
      action: "create",
      before: null,
      after: {
        date: "2026-11-18",
        saleCategory: "Toner",
        paymentMethod: "Cartão de crédito",
        cardMachine: "Mercado Pago",
        installments: 3,
        grossCents: 15000,
        feeRatePpm: 37900,
        feeCents: 569,
        netCents: 14431,
        note: "cliente da gráfica",
      },
    });
  });

  it("RN-02: a cash sale has rate 0 and fee 0, without machine or installments", async () => {
    const response = await post(cashSale());
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      cardMachineId: null,
      cardMachineName: null,
      installments: null,
      feeRatePpm: 0,
      feeCents: 0,
      netCents: 2500,
    });
  });

  it("RN-02: PIX without a machine has no fee; PIX through a machine uses its fee", async () => {
    const direct = await post(cashSale({ paymentMethodId: ids.pix }));
    expect(direct.json()).toMatchObject({ feeRatePpm: 0, feeCents: 0, netCents: 2500 });

    await createFee({
      cardMachineId: ids.pagSeguro,
      paymentMethodId: ids.pix,
      installmentsFrom: 1,
      installmentsTo: 1,
      ratePpm: 9900,
    });
    const viaMachine = await post(
      cashSale({ paymentMethodId: ids.pix, cardMachineId: ids.pagSeguro, grossCents: 10000 }),
    );
    expect(viaMachine.statusCode, viaMachine.body).toBe(201);
    expect(viaMachine.json()).toMatchObject({ feeRatePpm: 9900, feeCents: 99, netCents: 9901 });
  });

  it("FR-01: credit installments default to 1", async () => {
    await createFee({ installmentsFrom: 1, installmentsTo: 1, ratePpm: 31900 });
    const response = await post(
      cashSale({ paymentMethodId: ids.credit, cardMachineId: ids.mercadoPago }),
    );
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ installments: 1, feeRatePpm: 31900 });
  });

  it("FR-01: blocks a sale on a closed day and says the day must be reopened (FR-09)", async () => {
    closeDay("2026-11-17");
    const response = await post(cashSale({ date: "2026-11-17" }));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "O dia 17/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
      code: DAY_CLOSED_CODE,
    });
    expect(salesCount()).toBe(0);
    expect(await audit()).toEqual([]);
  });

  it("RN-14: blocks a sale on a day of a closed month", async () => {
    closeMonth("2026-10");
    const response = await post(cashSale({ date: "2026-10-20" }));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: DAY_CLOSED_CODE });
    expect(response.json().error).toContain("O mês 10/2026 está fechado");
  });

  it("FR-01: blocks the sale when there is no fee in force, naming machine / method / installments", async () => {
    await createFee({ installmentsFrom: 2, installmentsTo: 6 });
    const response = await post(
      cashSale({
        paymentMethodId: ids.credit,
        cardMachineId: ids.mercadoPago,
        installments: 7,
        grossCents: 15000,
      }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "Cadastre a taxa de Mercado Pago / Cartão de crédito / 7x antes de registrar esta venda",
      code: CARD_FEE_MISSING_CODE,
    });
    expect(salesCount()).toBe(0);
  });

  it("RN-01: a fee that starts after the sale date does not apply", async () => {
    await createFee({ validFrom: "2026-11-19" });
    const response = await post(
      cashSale({ paymentMethodId: ids.credit, cardMachineId: ids.mercadoPago, installments: 3 }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: CARD_FEE_MISSING_CODE });
  });

  it("RN-15: blocks a future date", async () => {
    const response = await post(cashSale({ date: "2026-11-19" }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Não é possível registrar lançamentos com data futura.",
    });
  });

  it("FR-01: accepts a past date on an open day", async () => {
    const response = await post(cashSale({ date: "2026-11-10" }));
    expect(response.statusCode, response.body).toBe(201);
    expect((await listSales("2026-11-10")).length).toBe(1);
  });

  it("FR-01: only active tabs, methods and machines", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/sale-categories/${ids.toner}`,
      payload: { active: false },
    });
    expect((await post(cashSale())).json()).toEqual({ error: "Escolha uma aba ativa." });

    await app.inject({
      method: "PATCH",
      url: `/api/payment-methods/${ids.cash}`,
      payload: { active: false },
    });
    expect((await post(cashSale({ saleCategoryId: ids.papelaria }))).json()).toEqual({
      error: "Escolha uma forma de pagamento ativa.",
    });

    await createFee({ installmentsFrom: 1, installmentsTo: 1 });
    await app.inject({
      method: "PATCH",
      url: `/api/card-machines/${ids.mercadoPago}`,
      payload: { active: false },
    });
    const inactiveMachine = await post(
      cashSale({
        saleCategoryId: ids.papelaria,
        paymentMethodId: ids.credit,
        cardMachineId: ids.mercadoPago,
      }),
    );
    expect(inactiveMachine.statusCode).toBe(400);
    expect(inactiveMachine.json()).toEqual({ error: "Escolha uma maquininha ativa." });
    expect(salesCount()).toBe(0);
  });

  it("FR-01: unknown ids are rejected like inactive ones", async () => {
    const response = await post(cashSale({ saleCategoryId: 999 }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Escolha uma aba ativa." });
  });

  it("FR-01: the machine is required for cards and not allowed for cash", async () => {
    const card = await post(cashSale({ paymentMethodId: ids.debit }));
    expect(card.statusCode).toBe(400);
    expect(card.json()).toEqual({ error: "Escolha a maquininha." });

    const cash = await post(cashSale({ cardMachineId: ids.pagSeguro }));
    expect(cash.statusCode).toBe(400);
    expect(cash.json()).toEqual({ error: "Dinheiro não usa maquininha." });
  });

  it("FR-01: installments only for methods that allow them", async () => {
    const response = await post(
      cashSale({ paymentMethodId: ids.debit, cardMachineId: ids.pagSeguro, installments: 3 }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cartão de débito não permite parcelas." });
  });

  it("FR-01: validates the body with pt-BR messages", async () => {
    expect((await post(cashSale({ grossCents: 0 }))).json()).toEqual({
      error: "Informe um valor maior que zero.",
    });
    const noBody = await app.inject({ method: "POST", url: SALES });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json()).toEqual({ error: "Dados inválidos." });
  });

  it("GET /api/sales needs a valid date", async () => {
    const response = await app.inject({ method: "GET", url: `${SALES}?date=ontem` });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Data inválida." });
  });

  it("GET /api/sales lists the day in the order the sales were registered", async () => {
    const first = saleSchema.parse((await post(cashSale({ grossCents: 100 }))).json());
    const second = saleSchema.parse((await post(cashSale({ grossCents: 200 }))).json());
    expect((await listSales("2026-11-18")).map((sale) => sale.id)).toEqual([first.id, second.id]);
  });
});

describe("FR-02: the fee is copied onto the sale", () => {
  it("FR-02: a sale of October keeps 1,99% after the rate changes to 1,49% on 01/11", async () => {
    const debitFee = { cardMachineId: ids.mercadoPago, paymentMethodId: ids.debit };
    await createFee({ ...debitFee, installmentsFrom: 1, installmentsTo: 1, ratePpm: 19900 });
    await createFee({
      ...debitFee,
      installmentsFrom: 1,
      installmentsTo: 1,
      ratePpm: 14900,
      validFrom: "2026-11-01",
    });

    const october = await post(cashSale({ ...debitFee, date: "2026-10-31", grossCents: 10000 }));
    expect(october.json()).toMatchObject({ feeRatePpm: 19900, feeCents: 199, netCents: 9801 });
    const november = await post(cashSale({ ...debitFee, date: "2026-11-01", grossCents: 10000 }));
    expect(november.json()).toMatchObject({ feeRatePpm: 14900, feeCents: 149, netCents: 9851 });

    const [stored] = await listSales("2026-10-31");
    expect(stored).toMatchObject({ feeRatePpm: 19900, feeCents: 199 });
  });

  it("FR-02: editing or deleting the fee row never recalculates saved sales", async () => {
    const fee = await createFee({ ratePpm: 37900 });
    await post(
      cashSale({
        paymentMethodId: ids.credit,
        cardMachineId: ids.mercadoPago,
        installments: 3,
        grossCents: 15000,
      }),
    );

    const edit = await app.inject({
      method: "PUT",
      url: `/api/card-fees/${fee.id}`,
      payload: {
        cardMachineId: ids.mercadoPago,
        paymentMethodId: ids.credit,
        installmentsFrom: 2,
        installmentsTo: 6,
        ratePpm: 50000,
        validFrom: "2026-01-01",
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect((await listSales("2026-11-18"))[0]).toMatchObject({
      feeRatePpm: 37900,
      feeCents: 569,
      netCents: 14431,
    });

    const remove = await app.inject({ method: "DELETE", url: `/api/card-fees/${fee.id}` });
    expect(remove.statusCode).toBe(204);
    expect((await listSales("2026-11-18"))[0]).toMatchObject({ feeRatePpm: 37900 });
  });
});
