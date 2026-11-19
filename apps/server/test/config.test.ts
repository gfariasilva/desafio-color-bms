import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-config-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function writeConfigFile(content: string) {
  fs.writeFileSync(path.join(dataDir, "config.json"), content);
}

describe("#25/#20: OneDrive folder sources (config.json to import, COLOR_BMS_ONEDRIVE_DIR)", () => {
  it("is not configured without the file or the variable", () => {
    const config = loadConfig({ COLOR_BMS_DATA_DIR: dataDir });
    expect(config.envOneDriveFolder).toBeNull();
    expect(config.legacyOneDriveFolder).toBeNull();
    expect(config.localBackupDir).toBe(path.join(dataDir, "backups"));
  });

  it("reads oneDriveFolder from config.json in the data folder", () => {
    writeConfigFile(JSON.stringify({ oneDriveFolder: "C:\\Users\\dono\\OneDrive\\Color" }));
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }).legacyOneDriveFolder).toBe(
      "C:\\Users\\dono\\OneDrive\\Color",
    );
  });

  it("accepts a config.json saved with a UTF-8 byte-order mark (PowerShell 5)", () => {
    writeConfigFile("\uFEFF" + JSON.stringify({ oneDriveFolder: "C:\\OneDrive\\Color" }));
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }).legacyOneDriveFolder).toBe(
      "C:\\OneDrive\\Color",
    );
  });

  it("#20: reads both the environment variable (override) and the file (to import)", () => {
    writeConfigFile(JSON.stringify({ oneDriveFolder: "/from/file" }));
    const config = loadConfig({ COLOR_BMS_DATA_DIR: dataDir, COLOR_BMS_ONEDRIVE_DIR: "/from/env" });
    expect(config.envOneDriveFolder).toBe("/from/env");
    expect(config.legacyOneDriveFolder).toBe("/from/file");
  });

  it("an invalid config.json is ignored with a warning (the app still starts)", () => {
    writeConfigFile("{ not json");
    const warn = vi.fn();
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }, warn).legacyOneDriveFolder).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("config.json"));
  });

  it("an empty or non-text oneDriveFolder is ignored with a warning", () => {
    writeConfigFile(JSON.stringify({ oneDriveFolder: 42 }));
    const warn = vi.fn();
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }, warn).legacyOneDriveFolder).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe("#26: trial mode (COLOR_BMS_TRIAL=1, set by the pilot launcher)", () => {
  it("#26: is off by default", () => {
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }).trial).toBe(false);
  });

  it("#26: is on with COLOR_BMS_TRIAL=1 (the settings store then never backs up, see settings.test.ts)", () => {
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir, COLOR_BMS_TRIAL: "1" }).trial).toBe(true);
  });
});
