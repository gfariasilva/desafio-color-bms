import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  folderTestResponseSchema,
  healthResponseSchema,
  settingsResponseSchema,
  type SettingsInput,
  type SettingsResponse,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { createBackupService } from "../src/modules/backup/backup.service";
import {
  createSettingsStore,
  type SettingsStore,
} from "../src/modules/settings/settings.repository";

/** 18/11/2026 at 15:00 in São Paulo (UTC−3). */
const NOW = new Date("2026-11-18T18:00:00.000Z");
const silentLog = { info: () => {}, error: () => {} };

let tempDir: string;
let oneDrive: string;
let connection: DatabaseConnection;
let app: FastifyInstance;
let store: SettingsStore;

interface AppOptions {
  envOneDriveFolder?: string | null;
  trial?: boolean;
}

async function startApp({ envOneDriveFolder = null, trial = false }: AppOptions = {}) {
  store = createSettingsStore(connection, { envOneDriveFolder, trial });
  const backup = createBackupService({
    sqlite: connection.sqlite,
    folder: () => store.backupFolder(),
    now: () => NOW,
    log: silentLog,
  });
  app = await buildApp({
    connection,
    now: () => NOW,
    settings: store,
    backup,
    system: {
      dataDir: tempDir,
      oneDriveFolder: () => store.backupFolder(),
      port: 3210,
      trial,
      builtAt: null,
    },
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-settings-"));
  oneDrive = path.join(tempDir, "OneDrive", "Color");
  fs.mkdirSync(oneDrive, { recursive: true });
  connection = openDatabase(path.join(tempDir, "test.db"));
  runMigrations(connection.db);
});

afterEach(async () => {
  await app?.close();
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function getSettings(): Promise<SettingsResponse> {
  const response = await app.inject({ method: "GET", url: "/api/settings" });
  expect(response.statusCode, response.body).toBe(200);
  return settingsResponseSchema.parse(response.json());
}

function put(input: SettingsInput) {
  return app.inject({ method: "PUT", url: "/api/settings", payload: input });
}

function testFolder(folder: string) {
  return app.inject({
    method: "POST",
    url: "/api/settings/onedrive-folder/test",
    payload: { folder },
  });
}

async function settingAudit() {
  const response = await app.inject({ method: "GET", url: "/api/audit?entity=setting" });
  return auditListResponseSchema.parse(response.json()).entries;
}

function storedRows() {
  return connection.sqlite.prepare("select key, value from settings order by key").all();
}

const defaults: SettingsInput = {
  oneDriveFolder: null,
  cashDifferenceLimitCents: 0,
  dueSoonDays: 3,
};

describe("FR-33: GET /api/settings", () => {
  it("FR-33: defaults when nothing is stored (limit R$ 0,00, 3 days, no folder)", async () => {
    await startApp();
    expect(await getSettings()).toEqual({
      ...defaults,
      oneDriveFolderSource: "settings",
      trial: false,
    });
  });
});

describe("FR-33: PUT /api/settings", () => {
  it("FR-33: saving writes one audit row per changed key, in the same transaction", async () => {
    await startApp();
    const response = await put({
      oneDriveFolder: oneDrive,
      cashDifferenceLimitCents: 500,
      dueSoonDays: 5,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(settingsResponseSchema.parse(response.json())).toMatchObject({
      oneDriveFolder: oneDrive,
      cashDifferenceLimitCents: 500,
      dueSoonDays: 5,
    });
    expect(await getSettings()).toMatchObject({ cashDifferenceLimitCents: 500, dueSoonDays: 5 });

    const entries = await settingAudit();
    expect(entries).toHaveLength(3);
    expect(
      entries.map((entry) => [entry.entityId, entry.action, entry.before, entry.after]),
    ).toEqual(
      expect.arrayContaining([
        ["oneDriveFolder", "create", null, { oneDriveFolder: oneDrive }],
        ["cashDifferenceLimitCents", "create", null, { cashDifferenceLimitCents: 500 }],
        ["dueSoonDays", "create", null, { dueSoonDays: 5 }],
      ]),
    );
    expect(entries.every((entry) => entry.at === NOW.toISOString())).toBe(true);
  });

  it("FR-33: a later change is an update with the value before and after", async () => {
    await startApp();
    await put({ ...defaults, dueSoonDays: 5 });
    await put({ ...defaults, dueSoonDays: 7 });

    const [latest] = await settingAudit();
    expect(latest).toMatchObject({
      entityId: "dueSoonDays",
      action: "update",
      before: { dueSoonDays: 5 },
      after: { dueSoonDays: 7 },
    });
  });

  it("FR-33: unchanged values write no audit row", async () => {
    await startApp();
    await put({ ...defaults, dueSoonDays: 5 });
    const before = (await settingAudit()).length;

    const response = await put({ ...defaults, dueSoonDays: 5 });
    expect(response.statusCode).toBe(200);
    expect(await settingAudit()).toHaveLength(before);
  });

  it("FR-33: saving the defaults on a fresh database writes nothing", async () => {
    await startApp();
    expect((await put(defaults)).statusCode).toBe(200);
    expect(await settingAudit()).toHaveLength(0);
    expect(storedRows()).toEqual([]);
  });

  it("FR-33: clearing the folder stores it as not configured, audited", async () => {
    await startApp();
    await put({ ...defaults, oneDriveFolder: oneDrive });
    await put(defaults);

    expect((await getSettings()).oneDriveFolder).toBeNull();
    const [latest] = await settingAudit();
    expect(latest).toMatchObject({
      entityId: "oneDriveFolder",
      action: "update",
      before: { oneDriveFolder: oneDrive },
      after: { oneDriveFolder: null },
    });
  });

  it("FR-33: rejects invalid values with a pt-BR message and stores nothing", async () => {
    await startApp();
    const negative = await put({ ...defaults, cashDifferenceLimitCents: -1 });
    expect(negative.statusCode).toBe(400);
    expect(negative.json()).toEqual({
      error: "O limite da diferença de caixa não pode ser negativo.",
    });

    const days = await put({ ...defaults, dueSoonDays: 31 });
    expect(days.statusCode).toBe(400);

    const relative = await put({ ...defaults, oneDriveFolder: "OneDrive\\Color" });
    expect(relative.statusCode).toBe(400);
    expect(relative.json().error).toMatch(/caminho completo/);

    expect(storedRows()).toEqual([]);
  });

  it("FR-33: saving a folder that fails Testar is refused, and nothing is stored", async () => {
    await startApp();
    const missing = path.join(tempDir, "Nao", "Existe");
    const response = await put({ ...defaults, dueSoonDays: 5, oneDriveFolder: missing });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: `A pasta não existe: ${missing}. Confira o caminho ou crie a pasta no OneDrive.`,
      code: "folder_test_failed",
    });
    expect(storedRows()).toEqual([]);
    expect(await settingAudit()).toHaveLength(0);
  });

  it("FR-33: a new folder is used at once by the backup and the startup check", async () => {
    await startApp();
    const health = async () =>
      healthResponseSchema
        .parse((await app.inject({ method: "GET", url: "/api/health" })).json())
        .checks.find((check) => check.id === "oneDriveFolder");
    expect((await health())?.status).toBe("warning"); // not configured

    expect((await put({ ...defaults, oneDriveFolder: oneDrive })).statusCode).toBe(200);

    expect((await health())?.status).toBe("ok");
    // FR-31: the new folder gets today's backup right away (it had none).
    const backupDir = path.join(oneDrive, "_backup-sistema");
    await vi.waitFor(() =>
      expect(fs.existsSync(path.join(backupDir, "color-2026-11-18_1500.db"))).toBe(true),
    );
    const status = (await app.inject({ method: "GET", url: "/api/backup/status" })).json();
    expect(status).toMatchObject({ configured: true, folder: backupDir, lastFailure: null });
  });
});

describe("FR-33: POST /api/settings/onedrive-folder/test (Testar)", () => {
  beforeEach(async () => {
    await startApp();
  });

  it("FR-33: Testar on a writable folder succeeds and leaves no file behind", async () => {
    const response = await testFolder(oneDrive);
    expect(response.statusCode).toBe(200);
    expect(folderTestResponseSchema.parse(response.json())).toEqual({
      ok: true,
      message: `Pasta OK: o sistema consegue gravar em ${oneDrive}.`,
    });
    expect(fs.readdirSync(oneDrive)).toEqual([]);
  });

  it('FR-33: Testar on a missing folder says "A pasta não existe", in pt-BR', async () => {
    const missing = path.join(tempDir, "Sem", "Pasta");
    const response = await testFolder(missing);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: false,
      message: `A pasta não existe: ${missing}. Confira o caminho ou crie a pasta no OneDrive.`,
    });
    // Testar never creates the folder.
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('FR-33: Testar on a file says "não é uma pasta"', async () => {
    const file = path.join(tempDir, "arquivo.txt");
    fs.writeFileSync(file, "x");
    expect((await testFolder(file)).json()).toEqual({
      ok: false,
      message: `O caminho não é uma pasta: ${file}.`,
    });
  });

  // chmod does not stop root, and Windows ignores the mode bits.
  const canDenyWrite = process.platform !== "win32" && process.getuid?.() !== 0;
  it.runIf(canDenyWrite)(
    'FR-33: Testar on a read-only folder says "Sem permissão para gravar"',
    async () => {
      fs.chmodSync(oneDrive, 0o555);
      try {
        expect((await testFolder(oneDrive)).json()).toEqual({
          ok: false,
          message: `Sem permissão para gravar na pasta ${oneDrive}.`,
        });
      } finally {
        fs.chmodSync(oneDrive, 0o755);
      }
    },
  );

  it("FR-33: Testar asks for a full path", async () => {
    const response = await testFolder("Color");
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/caminho completo/);
  });

  it("FR-33: Testar writes no audit row and stores nothing", async () => {
    await testFolder(oneDrive);
    expect(await settingAudit()).toHaveLength(0);
    expect(storedRows()).toEqual([]);
  });
});

describe("#20: COLOR_BMS_ONEDRIVE_DIR overrides the setting", () => {
  it("#20: the env folder is reported as read-only and wins over the stored one", async () => {
    const stored = path.join(tempDir, "Outra");
    fs.mkdirSync(stored);
    await startApp();
    await put({ ...defaults, oneDriveFolder: stored });
    await app.close();

    await startApp({ envOneDriveFolder: oneDrive });
    expect(await getSettings()).toMatchObject({
      oneDriveFolder: oneDrive,
      oneDriveFolderSource: "env",
    });
    expect(store.backupFolder()).toBe(oneDrive);
  });

  it("#20: under the env override, PUT keeps the stored folder and saves the rest", async () => {
    await startApp({ envOneDriveFolder: oneDrive });
    const response = await put({
      oneDriveFolder: oneDrive,
      cashDifferenceLimitCents: 0,
      dueSoonDays: 4,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(storedRows()).toEqual([{ key: "dueSoonDays", value: "4" }]);
  });
});

describe("#20: trial mode", () => {
  it("#20: the folder can be set, but trial mode never backs up to OneDrive", async () => {
    await startApp({ trial: true });
    await put({ ...defaults, oneDriveFolder: oneDrive });

    expect(await getSettings()).toMatchObject({ oneDriveFolder: oneDrive, trial: true });
    expect(store.backupFolder()).toBeNull();
  });
});

describe("#20: import of the pilot's config.json folder (#25)", () => {
  it("#20: imports oneDriveFolder once, with an audit row", async () => {
    await startApp();
    expect(store.importLegacyOneDriveFolder(oneDrive, NOW)).toBe(true);

    expect((await getSettings()).oneDriveFolder).toBe(oneDrive);
    const [entry] = await settingAudit();
    expect(entry).toMatchObject({
      entityId: "oneDriveFolder",
      action: "create",
      after: { oneDriveFolder: oneDrive },
      reason: "Importada do config.json do piloto.",
    });

    // A second start finds the setting and changes nothing.
    expect(store.importLegacyOneDriveFolder(oneDrive, NOW)).toBe(false);
    expect(await settingAudit()).toHaveLength(1);
  });

  it("#20: does not overwrite a folder set in Configurações (even when cleared)", async () => {
    await startApp();
    await put({ ...defaults, oneDriveFolder: oneDrive });
    await put(defaults); // cleared on purpose
    expect(store.importLegacyOneDriveFolder(path.join(tempDir, "Velha"), NOW)).toBe(false);
    expect((await getSettings()).oneDriveFolder).toBeNull();
  });

  it("#20: nothing to import when config.json has no folder", async () => {
    await startApp();
    expect(store.importLegacyOneDriveFolder(null, NOW)).toBe(false);
    expect(storedRows()).toEqual([]);
  });
});
