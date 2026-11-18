import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { healthResponseSchema } from "@color-bms/core";
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

describe("GET /api/health", () => {
  it("returns ok with database details", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.db.journalMode).toBe("wal");
    expect(body.db.settingsCount).toBe(0);
  });
});

describe("database setup (ADR 0001)", () => {
  it("creates the settings table through the first migration", () => {
    const table = connection.sqlite
      .prepare("select name from sqlite_master where type = 'table' and name = 'settings'")
      .get();
    expect(table).toEqual({ name: "settings" });
  });

  it("uses durable pragmas (NFR-06)", () => {
    // synchronous: 2 = FULL
    expect(connection.sqlite.pragma("synchronous", { simple: true })).toBe(2);
    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("runs migrations idempotently", () => {
    expect(() => runMigrations(connection.db)).not.toThrow();
  });
});

describe("host guard (NFR-08)", () => {
  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "evil.example.com" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects a cross-site Origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:3210", origin: "https://evil.example.com" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("accepts the local Vite dev server origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "localhost:5173", origin: "http://localhost:5173" },
    });
    expect(response.statusCode).toBe(200);
  });
});
