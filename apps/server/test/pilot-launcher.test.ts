import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALREADY_RUNNING_EXIT_CODE } from "../src/pilot/exit-codes";
import { restartDelayMs, superviseServer } from "../src/pilot/supervisor";

let dir: string;
let logText: string;
const log = { write: (chunk: string | Buffer) => void (logText += chunk.toString()) };
const noSleep = async () => {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-launcher-"));
  logText = "";
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the server: a tiny script, run with this Node, whose behaviour we choose. */
function fakeServer(source: string) {
  const file = path.join(dir, "server.cjs");
  fs.writeFileSync(file, source);
  let starts = 0;
  return {
    spawnServer: () => {
      starts++;
      return spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
    },
    starts: () => starts,
  };
}

describe("#26: the launcher keeps the server running", () => {
  it("#26: restarts a crashed server and the crash cause is in the log file", async () => {
    // The first run crashes with an uncaught error; the second one stops normally.
    const counter = path.join(dir, "runs.txt");
    const server = fakeServer(`
      const fs = require("node:fs");
      const runs = fs.existsSync(${JSON.stringify(counter)}) ? 1 : 0;
      fs.writeFileSync(${JSON.stringify(counter)}, "1");
      console.log("server started, run " + runs);
      if (runs === 0) throw new Error("boom: database file is locked");
      process.exit(0);
    `);
    const delays: number[] = [];
    const code = await superviseServer({
      ...server,
      log,
      now: () => new Date("2026-11-18T22:03:00.000Z"),
      sleep: async (ms) => void delays.push(ms),
    });

    expect(code).toBe(0);
    expect(server.starts()).toBe(2);
    expect(delays).toEqual([restartDelayMs(0)]);
    expect(logText).toContain("server started, run 0");
    expect(logText).toContain("Error: boom: database file is locked");
    expect(logText).toMatch(/Server stopped \(exit code 1\); restarting in \d+ s/);
    expect(logText).toContain("server started, run 1");
  });

  it("#26: a normal stop (exit code 0) is not restarted", async () => {
    const server = fakeServer("process.exit(0);");
    const code = await superviseServer({ ...server, log, now: () => new Date(), sleep: noSleep });
    expect(code).toBe(0);
    expect(server.starts()).toBe(1);
    expect(logText).toContain("Server stopped normally.");
  });

  it("#26: another instance already running (port in use by this system) is not restarted", async () => {
    const server = fakeServer(`process.exit(${ALREADY_RUNNING_EXIT_CODE});`);
    const code = await superviseServer({ ...server, log, now: () => new Date(), sleep: noSleep });
    expect(code).toBe(0);
    expect(server.starts()).toBe(1);
    expect(logText).toContain("already running");
  });

  it("#26: stops restarting when asked to stop", async () => {
    const server = fakeServer("process.exit(1);");
    let stop = false;
    const code = await superviseServer({
      ...server,
      log,
      now: () => new Date(),
      sleep: async () => void (stop = server.starts() >= 3),
      shouldStop: () => stop,
    });
    expect(code).toBe(1);
    expect(server.starts()).toBe(3);
  });

  it("#26: waits longer after each crash in a row, up to one minute", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(restartDelayMs)).toEqual([
      2_000, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000,
    ]);
  });

  it("#26: a server that ran for a while resets the wait to the shortest", async () => {
    const server = fakeServer("process.exit(1);");
    let clock = 0;
    const delays: number[] = [];
    await superviseServer({
      ...server,
      log,
      // Every run "lasts" 10 minutes: always more than the stable threshold.
      now: () => new Date((clock += 5 * 60_000)),
      sleep: async (ms) => void delays.push(ms),
      shouldStop: () => delays.length >= 3,
    });
    expect(delays).toEqual([2_000, 2_000, 2_000]);
  });
});
