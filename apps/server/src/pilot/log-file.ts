import fs from "node:fs";
import path from "node:path";
import { toCivilDate } from "@color-bms/core";
import type { Clock } from "../clock";

const LOG_FILE = /^color-bms-\d{4}-\d{2}-\d{2}\.log$/;

/** #26: one log file per day, named by the São Paulo date (RN-15): `color-bms-AAAA-MM-DD.log`. */
export function logFileName(now: Date): string {
  return `color-bms-${toCivilDate(now)}.log`;
}

export interface DailyLog {
  /** Appends to today's file. Never throws: logging must never stop the system. */
  write(chunk: string | Buffer): void;
  currentFile(): string;
}

export interface DailyLogOptions {
  dir: string;
  now: Clock;
  /** How many daily files to keep (the newest). About a month by default. */
  keepFiles?: number;
}

/**
 * #26: the server's log on the shop PC (`data\logs\`), where the hidden process has no console.
 * Writes are synchronous, so the last lines before a crash are on disk. A new day starts a new
 * file and the oldest files beyond `keepFiles` are removed (rotation).
 */
export function createDailyLog({ dir, now, keepFiles = 31 }: DailyLogOptions): DailyLog {
  let file = "";

  function prune(): void {
    const names = fs
      .readdirSync(dir)
      .filter((name) => LOG_FILE.test(name))
      .sort();
    for (const name of names.slice(0, Math.max(0, names.length - keepFiles))) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }

  function current(): string {
    const next = path.join(dir, logFileName(now()));
    if (next !== file) {
      file = next;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(file, "");
        prune();
      } catch {
        // Reported by the write below, which also fails; nothing else to do.
      }
    }
    return file;
  }

  return {
    write(chunk) {
      try {
        fs.appendFileSync(current(), chunk);
      } catch {
        // A full disk or a removed folder must not crash the launcher.
      }
    },
    currentFile: current,
  };
}
