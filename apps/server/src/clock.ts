/**
 * The server's only source of "now" (ADR 0002). Business code receives a `Clock` instead of
 * calling `new Date()`, so tests control the time and "today" (RN-15) is the same for the
 * server and the UI (the UI asks GET /api/today).
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/**
 * The clock for this process. **Only when NODE_ENV=test**, COLOR_BMS_NOW (an ISO instant)
 * sets the starting time, and the clock advances in real time from there: E2E tests for
 * "today", future dates and midnight in São Paulo become deterministic.
 * Anywhere else the variable is ignored, with a warning.
 */
export function createClock(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): Clock {
  const start = env.COLOR_BMS_NOW;
  if (!start) return systemClock;
  if (env.NODE_ENV !== "test") {
    warn("COLOR_BMS_NOW is ignored: it only works with NODE_ENV=test.");
    return systemClock;
  }
  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) {
    throw new Error(`COLOR_BMS_NOW must be an ISO instant, received "${start}"`);
  }
  const offsetMs = startMs - Date.now();
  return () => new Date(Date.now() + offsetMs);
}
