import { eq } from "drizzle-orm";
import {
  DEFAULT_SETTINGS,
  isAbsoluteFolderPath,
  sameFolderPath,
  SETTING_KEYS,
  type SettingKey,
  type Settings,
  type SettingsResponse,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction, DatabaseConnection } from "../../db/client";
import { settings } from "../../db/schema";
import { recordAudit } from "../audit/audit.repository";

/**
 * FR-33: the settings, stored one row per key in `settings` (spec §6.1 "Configuração").
 *
 * Storage: the folder as text ("" = cleared on purpose, so the #25 config.json import never
 * runs again), the numbers as decimal text. A missing row means "use the default".
 */

export interface SettingsStoreOptions {
  /**
   * `COLOR_BMS_ONEDRIVE_DIR`: overrides the stored folder (development and E2E tests only; the
   * shop PC never sets it). Null when not set.
   */
  envOneDriveFolder: string | null;
  /** #26 trial mode: never back up to OneDrive, whatever the folder. */
  trial: boolean;
}

export interface SettingsStore {
  /** GET /api/settings: the values in effect (defaults filled in, env override applied). */
  read(): SettingsResponse;
  /** The OneDrive folder in effect: the env override, else the stored one, else null. */
  oneDriveFolder(): string | null;
  /** Where backups and exports go: `oneDriveFolder()`, but always null in trial mode. */
  backupFolder(): string | null;
  /**
   * FR-33: saves the changed values with one audit row per changed key, all in one
   * transaction (FR-18). Under the env override the stored folder is left as it is.
   * Returns the keys that changed.
   */
  save(input: Settings, now: Date): SettingKey[];
  /**
   * #20: moves the pilot's `config.json` folder (#25) into the settings, once: only when no
   * folder row exists yet. Returns whether it imported.
   */
  importLegacyOneDriveFolder(folder: string | null, now: Date): boolean;
}

type Db = AppDatabase | AppTransaction;

type StoredRows = Partial<Record<SettingKey, string>>;

function readRows(db: Db): StoredRows {
  const rows: StoredRows = {};
  for (const row of db.select().from(settings).all()) {
    if ((SETTING_KEYS as readonly string[]).includes(row.key))
      rows[row.key as SettingKey] = row.value;
  }
  return rows;
}

/** A stored whole number, or the default when missing or unreadable (never breaks a page). */
function storedInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

/** The stored settings, with the defaults for missing rows. */
function storedSettings(rows: StoredRows): Settings {
  return {
    oneDriveFolder:
      rows.oneDriveFolder === undefined || rows.oneDriveFolder === ""
        ? DEFAULT_SETTINGS.oneDriveFolder
        : rows.oneDriveFolder,
    cashDifferenceLimitCents: storedInteger(
      rows.cashDifferenceLimitCents,
      DEFAULT_SETTINGS.cashDifferenceLimitCents,
    ),
    dueSoonDays: storedInteger(rows.dueSoonDays, DEFAULT_SETTINGS.dueSoonDays),
  };
}

function toText(key: SettingKey, value: Settings[SettingKey]): string {
  if (key === "oneDriveFolder") return (value as string | null) ?? "";
  return String(value);
}

export function createSettingsStore(
  { db }: DatabaseConnection,
  { envOneDriveFolder, trial }: SettingsStoreOptions,
): SettingsStore {
  function oneDriveFolder(): string | null {
    return envOneDriveFolder ?? storedSettings(readRows(db)).oneDriveFolder;
  }

  function writeSetting(
    tx: AppTransaction,
    key: SettingKey,
    hadRow: boolean,
    before: Settings[SettingKey] | null,
    after: Settings[SettingKey],
    now: Date,
    reason: string | null = null,
  ): void {
    const value = toText(key, after);
    const updatedAt = now.toISOString();
    if (hadRow) {
      tx.update(settings).set({ value, updatedAt }).where(eq(settings.key, key)).run();
    } else {
      tx.insert(settings).values({ key, value, updatedAt }).run();
    }
    // FR-18: the key is the entity id; `before`/`after` use the key itself as the field, so
    // the Auditoria screen shows "Limite da diferença de caixa: R$ 0,00 → R$ 5,00".
    recordAudit(
      tx,
      {
        entity: "setting",
        entityId: key,
        action: hadRow ? "update" : "create",
        before: hadRow ? { [key]: before } : null,
        after: { [key]: after },
        reason,
      },
      now,
    );
  }

  return {
    read() {
      const stored = storedSettings(readRows(db));
      return {
        ...stored,
        oneDriveFolder: envOneDriveFolder ?? stored.oneDriveFolder,
        oneDriveFolderSource: envOneDriveFolder !== null ? "env" : "settings",
        trial,
      };
    },

    oneDriveFolder,

    backupFolder: () => (trial ? null : oneDriveFolder()),

    save(input, now) {
      // better-sqlite3 transactions are synchronous: no await inside.
      return db.transaction((tx) => {
        const rows = readRows(tx);
        const current = storedSettings(rows);
        const changed: SettingKey[] = [];
        for (const key of SETTING_KEYS) {
          if (key === "oneDriveFolder" && envOneDriveFolder !== null) continue;
          const unchanged =
            key === "oneDriveFolder"
              ? sameFolderPath(input.oneDriveFolder, current.oneDriveFolder)
              : input[key] === current[key];
          if (unchanged) continue;
          writeSetting(tx, key, rows[key] !== undefined, current[key], input[key], now);
          changed.push(key);
        }
        return changed;
      });
    },

    importLegacyOneDriveFolder(folder, now) {
      // Only a full path: a relative one would block every later save (settingsInputSchema).
      if (folder === null || !isAbsoluteFolderPath(folder)) return false;
      return db.transaction((tx) => {
        if (readRows(tx).oneDriveFolder !== undefined) return false;
        writeSetting(
          tx,
          "oneDriveFolder",
          false,
          null,
          folder,
          now,
          "Importada do config.json do piloto.",
        );
        return true;
      });
    },
  };
}
