import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { healthResponseSchema, type StartupCheck } from "@color-bms/core";
import { buildApp, type SystemInfo } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

const NOW = new Date("2026-11-18T22:03:00.000Z");
let tempDir: string;
let connection: DatabaseConnection;
let app: FastifyInstance | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-checks-"));
  connection = openDatabase(path.join(tempDir, "data", "color.db"));
  runMigrations(connection.db);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function system(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    dataDir: path.join(tempDir, "data"),
    oneDriveFolder: null,
    port: 3210,
    trial: false,
    builtAt: null,
    ...overrides,
  };
}

async function health(info: SystemInfo) {
  app = await buildApp({ connection, now: () => NOW, system: info });
  const response = await app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
  return healthResponseSchema.parse(response.json());
}

const byId = (checks: StartupCheck[], id: string) => checks.find((check) => check.id === id);

describe("#26: startup checks on the health page", () => {
  it("#26: the health page reports the server clock (not the OS clock directly) and the mode", async () => {
    const body = await health(system());
    expect(body.serverTime).toBe(NOW.toISOString());
    expect(body.trial).toBe(false);
  });

  it("#26: lists time zone, clock, port, data folder and OneDrive folder", async () => {
    const body = await health(system());
    expect(body.checks.map((check) => check.id)).toEqual([
      "timeZone",
      "clock",
      "port",
      "dataFolder",
      "oneDriveFolder",
    ]);
    expect(byId(body.checks, "port")?.message).toContain("3210");
    expect(byId(body.checks, "dataFolder")).toMatchObject({ status: "ok" });
    expect(byId(body.checks, "oneDriveFolder")).toMatchObject({ status: "warning" });
  });

  it("#26: the data folder check writes and removes a probe file", async () => {
    const body = await health(system());
    expect(byId(body.checks, "dataFolder")?.status).toBe("ok");
    const left = fs.readdirSync(path.join(tempDir, "data")).filter((n) => n.includes("teste"));
    expect(left).toEqual([]);
  });

  it("#26: a data folder that cannot be written is an error", async () => {
    const notAFolder = path.join(tempDir, "file.txt");
    fs.writeFileSync(notAFolder, "x");
    const body = await health(system({ dataDir: notAFolder }));
    expect(byId(body.checks, "dataFolder")).toMatchObject({ status: "error" });
    expect(byId(body.checks, "dataFolder")?.message).toContain(notAFolder);
  });

  it("#26: a writable OneDrive folder is ok, and its _backup-sistema is used for the probe", async () => {
    const oneDrive = path.join(tempDir, "OneDrive");
    fs.mkdirSync(oneDrive);
    const body = await health(system({ oneDriveFolder: oneDrive }));
    expect(byId(body.checks, "oneDriveFolder")).toEqual({
      id: "oneDriveFolder",
      status: "ok",
      message: `Pasta do OneDrive gravável: ${oneDrive}`,
    });
    expect(fs.readdirSync(path.join(oneDrive, "_backup-sistema"))).toEqual([]);
  });

  it("#26: a missing OneDrive folder is an error and is never created", async () => {
    const oneDrive = path.join(tempDir, "Missing");
    const body = await health(system({ oneDriveFolder: oneDrive }));
    expect(byId(body.checks, "oneDriveFolder")).toMatchObject({ status: "error" });
    expect(fs.existsSync(oneDrive)).toBe(false);
  });

  it("#26: trial mode says there is no OneDrive backup, and the health page says trial", async () => {
    const body = await health(system({ trial: true }));
    expect(body.trial).toBe(true);
    expect(byId(body.checks, "oneDriveFolder")).toMatchObject({
      status: "ok",
      message: "Modo treino: sem backup no OneDrive.",
    });
  });

  it("#26: a clock earlier than the latest audit row is an error", async () => {
    connection.sqlite
      .prepare(
        "insert into audit_log (at, entity, entity_id, action, before_json, after_json, reason) values (?, 'sale', '1', 'create', null, '{}', null)",
      )
      .run("2026-11-20T12:00:00.000Z");
    const body = await health(system());
    expect(byId(body.checks, "clock")).toMatchObject({ status: "error" });
  });

  it("without system info (unit tests), only the clock checks are listed", async () => {
    app = await buildApp({ connection, now: () => NOW });
    const body = healthResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/health" })).json(),
    );
    expect(body.checks.map((check) => check.id)).toEqual(["timeZone", "clock"]);
    expect(body.trial).toBe(false);
  });
});
