import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { auditListResponseSchema } from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { settings } from "../src/db/schema";
import { recordAudit } from "../src/modules/audit/audit.repository";

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

async function getAudit(query = "") {
  const response = await app.inject({ method: "GET", url: `/api/audit${query}` });
  return response;
}

async function listAudit(query = "") {
  const response = await getAudit(query);
  expect(response.statusCode).toBe(200);
  return auditListResponseSchema.parse(response.json());
}

/** Synthetic entry for the spec example: a sale edited from R$ 50,00 to R$ 5,00. */
function recordEditedSale(at: string) {
  recordAudit(
    connection.db,
    {
      entity: "sale",
      entityId: "42",
      action: "update",
      before: { grossCents: 5000 },
      after: { grossCents: 500 },
      reason: "Valor digitado errado",
    },
    new Date(at),
  );
}

describe("recordAudit (FR-18)", () => {
  it("FR-18: records an entry with when, entity, action, before/after and reason", async () => {
    recordEditedSale("2026-11-18T15:00:00.000Z");

    const { entries, hasMore } = await listAudit();
    expect(hasMore).toBe(false);
    expect(entries).toEqual([
      {
        id: expect.any(Number),
        at: "2026-11-18T15:00:00.000Z",
        entity: "sale",
        entityId: "42",
        action: "update",
        before: { grossCents: 5000 },
        after: { grossCents: 500 },
        reason: "Valor digitado errado",
      },
    ]);
  });

  it("FR-18: stores missing before/after and reason as null", async () => {
    recordAudit(connection.db, { entity: "day", entityId: "2026-11-18", action: "close" });
    const [entry] = (await listAudit()).entries;
    expect(entry).toMatchObject({ before: null, after: null, reason: null });
  });

  it("FR-18: audit row rolls back with the business write (one transaction)", () => {
    const write = () =>
      connection.db.transaction((tx) => {
        tx.insert(settings)
          .values({ key: "example", value: "1", updatedAt: new Date().toISOString() })
          .run();
        recordAudit(tx, { entity: "setting", entityId: "example", action: "create" });
        throw new Error("business rule failed after both writes");
      });

    expect(write).toThrow("business rule failed");
    expect(connection.sqlite.prepare("select count(*) from settings").pluck().get()).toBe(0);
    expect(connection.sqlite.prepare("select count(*) from audit_log").pluck().get()).toBe(0);
  });

  it("FR-18: audit row commits with the business write", () => {
    connection.db.transaction((tx) => {
      tx.insert(settings)
        .values({ key: "example", value: "1", updatedAt: new Date().toISOString() })
        .run();
      recordAudit(tx, { entity: "setting", entityId: "example", action: "create" });
    });
    expect(connection.sqlite.prepare("select count(*) from audit_log").pluck().get()).toBe(1);
  });
});

describe("GET /api/audit (FR-18)", () => {
  it("FR-18: finds the edited sale filtering by date", async () => {
    recordEditedSale("2026-11-10T15:00:00.000Z");
    recordAudit(
      connection.db,
      { entity: "sale", entityId: "43", action: "create", after: { grossCents: 1000 } },
      new Date("2026-11-12T15:00:00.000Z"),
    );

    const { entries } = await listAudit("?from=2026-11-10&to=2026-11-10");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityId: "42",
      before: { grossCents: 5000 },
      after: { grossCents: 500 },
    });
  });

  it("FR-18: finds the edited sale filtering by entity type", async () => {
    recordEditedSale("2026-11-10T15:00:00.000Z");
    recordAudit(
      connection.db,
      { entity: "sale_category", entityId: "1", action: "update", before: { name: "A" } },
      new Date("2026-11-10T16:00:00.000Z"),
    );

    const { entries } = await listAudit("?entity=sale");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entity: "sale",
      before: { grossCents: 5000 },
      after: { grossCents: 500 },
    });
  });

  it("FR-18: filters by action", async () => {
    recordEditedSale("2026-11-10T15:00:00.000Z");
    recordAudit(connection.db, { entity: "day", entityId: "2026-11-10", action: "close" });
    const { entries } = await listAudit("?action=close");
    expect(entries.map((entry) => entry.entity)).toEqual(["day"]);
  });

  it("RN-15/FR-18: date filter uses São Paulo civil days", async () => {
    recordEditedSale("2026-11-19T02:30:00.000Z"); // 23:30 on 18/11 in São Paulo
    recordEditedSale("2026-11-19T03:00:00.000Z"); // 00:00 on 19/11 in São Paulo

    const day18 = await listAudit("?from=2026-11-18&to=2026-11-18");
    expect(day18.entries.map((entry) => entry.at)).toEqual(["2026-11-19T02:30:00.000Z"]);

    const day19 = await listAudit("?from=2026-11-19&to=2026-11-19");
    expect(day19.entries.map((entry) => entry.at)).toEqual(["2026-11-19T03:00:00.000Z"]);
  });

  it("FR-18: returns the newest entries first and pages with beforeId", async () => {
    recordEditedSale("2026-11-10T15:00:00.000Z");
    recordEditedSale("2026-11-11T15:00:00.000Z");
    recordEditedSale("2026-11-12T15:00:00.000Z");

    const first = await listAudit("?limit=2");
    expect(first.hasMore).toBe(true);
    expect(first.entries.map((entry) => entry.at.slice(0, 10))).toEqual([
      "2026-11-12",
      "2026-11-11",
    ]);

    const lastId = first.entries[1]?.id;
    const second = await listAudit(`?limit=2&beforeId=${lastId}`);
    expect(second.hasMore).toBe(false);
    expect(second.entries.map((entry) => entry.at.slice(0, 10))).toEqual(["2026-11-10"]);
  });

  it("FR-18: rejects invalid filters in pt-BR", async () => {
    const badDate = await getAudit("?from=2026-02-30");
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json()).toEqual({ error: "Data inicial inválida." });

    const reversed = await getAudit("?from=2026-11-19&to=2026-11-18");
    expect(reversed.statusCode).toBe(400);
    expect(reversed.json()).toEqual({
      error: "A data inicial deve ser anterior ou igual à data final.",
    });

    const unknownType = await getAudit("?entity=foo");
    expect(unknownType.statusCode).toBe(400);
    expect(unknownType.json()).toEqual({ error: "Tipo de registro desconhecido." });
  });

  it("FR-18: audit rows cannot be edited or deleted through the API", async () => {
    recordEditedSale("2026-11-10T15:00:00.000Z");
    const [entry] = (await listAudit()).entries;

    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const response = await app.inject({ method, url: `/api/audit/${entry?.id}` });
      expect(response.statusCode).toBe(404);
    }
    const deleteAll = await app.inject({ method: "DELETE", url: "/api/audit" });
    expect(deleteAll.statusCode).toBe(404);

    expect((await listAudit()).entries).toHaveLength(1);
  });
});
