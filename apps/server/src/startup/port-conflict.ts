/** Who answers on a port that this server could not listen on (EADDRINUSE). */
export type PortOwner = "color-bms" | "other" | "none";

/**
 * #26: when port 3210 is taken, tell another instance of this system (started twice, e.g.
 * iniciar.cmd while the task already runs) from another program. The first is harmless: the
 * launcher stops quietly. The second needs the developer: the log says which port.
 */
export async function identifyPortOwner(port: number, timeoutMs = 3_000): Promise<PortOwner> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json().catch(() => null)) as {
      status?: unknown;
      version?: unknown;
    } | null;
    return body?.status === "ok" && typeof body.version === "string" ? "color-bms" : "other";
  } catch {
    // Connection refused or no answer in time: nobody we can talk to.
    return "none";
  }
}
