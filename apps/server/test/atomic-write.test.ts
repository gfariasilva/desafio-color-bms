import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomic } from "../src/modules/export/atomic-write";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-atomic-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("§7.4: atomic write (temp file in the same folder, then rename)", () => {
  it("§7.4: writes the file and leaves no temp file", () => {
    const file = path.join(dir, "Diária 2026-11-18.xlsx");
    writeFileAtomic(file, Buffer.from("novo"));
    expect(fs.readFileSync(file, "utf8")).toBe("novo");
    expect(fs.readdirSync(dir)).toEqual(["Diária 2026-11-18.xlsx"]);
  });

  it("FR-28: overwrites an existing file", () => {
    const file = path.join(dir, "Diária 2026-11-18.xlsx");
    fs.writeFileSync(file, "antigo");
    writeFileAtomic(file, Buffer.from("corrigido"));
    expect(fs.readFileSync(file, "utf8")).toBe("corrigido");
  });

  it("§7.4: replaces a temp file left by an earlier power cut", () => {
    const file = path.join(dir, "Diária 2026-11-18.xlsx");
    fs.writeFileSync(`${file}.tmp`, "meio arquivo");
    writeFileAtomic(file, Buffer.from("inteiro"));
    expect(fs.readFileSync(file, "utf8")).toBe("inteiro");
    expect(fs.readdirSync(dir)).toEqual(["Diária 2026-11-18.xlsx"]);
  });

  it("§7.4: a file locked by Excel (EPERM/EBUSY on rename) fails with EBUSY, keeps the old file and removes the temp file", () => {
    const file = path.join(dir, "Diária 2026-11-18.xlsx");
    fs.writeFileSync(file, "antigo");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    });
    expect(() => writeFileAtomic(file, Buffer.from("novo"))).toThrow(
      expect.objectContaining({ code: "EBUSY" }),
    );
    expect(fs.readFileSync(file, "utf8")).toBe("antigo");
    expect(fs.readdirSync(dir)).toEqual(["Diária 2026-11-18.xlsx"]);
  });

  it("§7.4: a leftover temp file locked by OneDrive (EPERM on open) is reported as in use (EBUSY)", () => {
    const file = path.join(dir, "Diária 2026-11-18.xlsx");
    vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM: operation not permitted, open"), { code: "EPERM" });
    });
    expect(() => writeFileAtomic(file, Buffer.from("novo"))).toThrow(
      expect.objectContaining({ code: "EBUSY" }),
    );
  });

  it("§7.4: a missing folder fails and writes nothing", () => {
    const file = path.join(dir, "não existe", "Diária 2026-11-18.xlsx");
    expect(() => writeFileAtomic(file, Buffer.from("x"))).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
