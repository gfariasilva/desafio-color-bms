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

describe("#25: OneDrive folder setting (config.json or COLOR_BMS_ONEDRIVE_DIR)", () => {
  it("is not configured without the file or the variable", () => {
    const config = loadConfig({ COLOR_BMS_DATA_DIR: dataDir });
    expect(config.oneDriveFolder).toBeNull();
    expect(config.localBackupDir).toBe(path.join(dataDir, "backups"));
  });

  it("reads oneDriveFolder from config.json in the data folder", () => {
    writeConfigFile(JSON.stringify({ oneDriveFolder: "C:\\Users\\dono\\OneDrive\\Color" }));
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }).oneDriveFolder).toBe(
      "C:\\Users\\dono\\OneDrive\\Color",
    );
  });

  it("accepts a config.json saved with a UTF-8 byte-order mark (PowerShell 5)", () => {
    writeConfigFile("\uFEFF" + JSON.stringify({ oneDriveFolder: "C:\\OneDrive\\Color" }));
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }).oneDriveFolder).toBe("C:\\OneDrive\\Color");
  });

  it("the environment variable wins over the file", () => {
    writeConfigFile(JSON.stringify({ oneDriveFolder: "/from/file" }));
    const config = loadConfig({ COLOR_BMS_DATA_DIR: dataDir, COLOR_BMS_ONEDRIVE_DIR: "/from/env" });
    expect(config.oneDriveFolder).toBe("/from/env");
  });

  it("an invalid config.json is ignored with a warning (the app still starts)", () => {
    writeConfigFile("{ not json");
    const warn = vi.fn();
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }, warn).oneDriveFolder).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("config.json"));
  });

  it("an empty or non-text oneDriveFolder is ignored with a warning", () => {
    writeConfigFile(JSON.stringify({ oneDriveFolder: 42 }));
    const warn = vi.fn();
    expect(loadConfig({ COLOR_BMS_DATA_DIR: dataDir }, warn).oneDriveFolder).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
