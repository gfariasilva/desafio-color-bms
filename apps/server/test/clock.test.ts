import { describe, expect, it, vi } from "vitest";
import { createClock, systemClock } from "../src/clock";

describe("clock (ADR 0002)", () => {
  it("uses the system time by default", () => {
    expect(createClock({})).toBe(systemClock);
  });

  it("starts at COLOR_BMS_NOW with NODE_ENV=test and advances in real time", () => {
    const clock = createClock({ NODE_ENV: "test", COLOR_BMS_NOW: "2026-11-18T18:00:00.000Z" });
    const first = clock().getTime();
    expect(first).toBeGreaterThanOrEqual(Date.parse("2026-11-18T18:00:00.000Z"));
    expect(first).toBeLessThan(Date.parse("2026-11-18T18:00:05.000Z"));
    expect(clock().getTime()).toBeGreaterThanOrEqual(first);
  });

  it("ignores COLOR_BMS_NOW outside tests, with a warning", () => {
    const warn = vi.fn();
    const clock = createClock(
      { NODE_ENV: "production", COLOR_BMS_NOW: "2000-01-01T00:00:00Z" },
      warn,
    );
    expect(clock).toBe(systemClock);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("COLOR_BMS_NOW is ignored"));
  });

  it("rejects an invalid instant", () => {
    expect(() => createClock({ NODE_ENV: "test", COLOR_BMS_NOW: "amanhã" })).toThrow(
      /COLOR_BMS_NOW/,
    );
  });
});
