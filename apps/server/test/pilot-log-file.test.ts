import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDailyLog, logFileName } from "../src/pilot/log-file";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-logs-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("#26: server log files in data\\logs (rotated)", () => {
  it("#26: one file per São Paulo day", () => {
    expect(logFileName(new Date("2026-11-18T22:03:00.000Z"))).toBe("color-bms-2026-11-18.log");
    // 02:59Z on the 19th is still 23:59 on the 18th in São Paulo (RN-15).
    expect(logFileName(new Date("2026-11-19T02:59:00.000Z"))).toBe("color-bms-2026-11-18.log");
    expect(logFileName(new Date("2026-11-19T03:00:00.000Z"))).toBe("color-bms-2026-11-19.log");
  });

  it("#26: appends to today's file and switches file at midnight in São Paulo", () => {
    let now = new Date("2026-11-19T02:59:00.000Z");
    const log = createDailyLog({ dir: path.join(dir, "logs"), now: () => now });
    log.write("first\n");
    log.write("second\n");
    now = new Date("2026-11-19T03:00:01.000Z");
    log.write("third\n");
    expect(fs.readFileSync(path.join(dir, "logs", "color-bms-2026-11-18.log"), "utf8")).toBe(
      "first\nsecond\n",
    );
    expect(fs.readFileSync(path.join(dir, "logs", "color-bms-2026-11-19.log"), "utf8")).toBe(
      "third\n",
    );
    expect(log.currentFile()).toBe(path.join(dir, "logs", "color-bms-2026-11-19.log"));
  });

  it("#26: keeps only the newest log files and never touches other files", () => {
    for (let day = 1; day <= 5; day++) {
      fs.writeFileSync(path.join(dir, `color-bms-2026-11-0${day}.log`), "old\n");
    }
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const log = createDailyLog({
      dir,
      now: () => new Date("2026-11-18T12:00:00.000Z"),
      keepFiles: 3,
    });
    log.write("today\n");
    expect(fs.readdirSync(dir).sort()).toEqual([
      "color-bms-2026-11-04.log",
      "color-bms-2026-11-05.log",
      "color-bms-2026-11-18.log",
      "notes.txt",
    ]);
  });

  it("#26: a log write never throws (logging must not stop the system)", () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const log = createDailyLog({ dir: path.join(blocker, "logs"), now: () => new Date() });
    expect(() => log.write("lost\n")).not.toThrow();
  });
});
