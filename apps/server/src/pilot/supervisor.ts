import type { ChildProcess } from "node:child_process";
import type { Clock } from "../clock";
import { ALREADY_RUNNING_EXIT_CODE } from "./exit-codes";

/** Waits after crashes in a row: quick at first, then at most a minute (never gives up). */
const RESTART_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** A server that ran this long before stopping counts as a fresh failure, not a crash loop. */
const STABLE_AFTER_MS = 5 * 60_000;

/** #26: how long to wait before the next start, after `failuresInARow` earlier crashes. */
export function restartDelayMs(failuresInARow: number): number {
  return RESTART_DELAYS_MS[Math.min(failuresInARow, RESTART_DELAYS_MS.length - 1)]!;
}

export interface SuperviseOptions {
  /** Starts the server with stdout and stderr piped. */
  spawnServer: () => ChildProcess;
  log: { write(chunk: string | Buffer): void };
  now: Clock;
  sleep: (ms: number) => Promise<void>;
  /** Checked after each stop; true ends the loop (the launcher is being stopped). */
  shouldStop?: () => boolean;
}

/**
 * #26: keeps the server running on the shop PC. Its stdout and stderr go to the log file, so
 * the cause of a crash (the stack trace Node prints) is always there. A crash is restarted after
 * a short wait; a normal stop (exit 0), or another instance already serving the port, ends it.
 *
 * Resolves with the launcher's exit code.
 */
export async function superviseServer({
  spawnServer,
  log,
  now,
  sleep,
  shouldStop = () => false,
}: SuperviseOptions): Promise<number> {
  const note = (message: string) => log.write(`${now().toISOString()} [launcher] ${message}\n`);
  let failuresInARow = 0;

  for (;;) {
    const startedAt = now().getTime();
    const child = spawnServer();
    note(`Server started (pid ${child.pid ?? "?"}).`);
    child.stdout?.on("data", (chunk: Buffer) => log.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => log.write(chunk));

    const { code, signal } = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      // "close" fires after the pipes are drained: the last lines of a crash are logged first.
      child.once("close", (exitCode, exitSignal) =>
        resolve({ code: exitCode, signal: exitSignal }),
      );
      child.once("error", (error) => {
        note(`Could not start the server: ${error.message}`);
        resolve({ code: null, signal: null });
      });
    });

    if (code === 0) {
      note("Server stopped normally.");
      return 0;
    }
    if (code === ALREADY_RUNNING_EXIT_CODE) {
      note("Another instance is already running on this port; this launcher stops.");
      return 0;
    }
    if (shouldStop()) return 1;

    if (now().getTime() - startedAt >= STABLE_AFTER_MS) failuresInARow = 0;
    const delay = restartDelayMs(failuresInARow);
    failuresInARow++;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? "?"}`;
    note(`Server stopped (${reason}); restarting in ${Math.round(delay / 1000)} s.`);
    await sleep(delay);
    if (shouldStop()) return 1;
  }
}
