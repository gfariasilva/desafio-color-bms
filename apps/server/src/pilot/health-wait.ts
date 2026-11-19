export type HealthWaitResult = { ok: true; version: string } | { ok: false; reason: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchVersion(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(new URL("api/health", baseUrl), {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * #26: waits until the server answers GET /api/health, and, when `version` is given, with that
 * version (after an update, the old server may still be answering for a moment).
 */
export async function waitForHealth(
  baseUrl: string,
  { version, timeoutMs }: { version?: string; timeoutMs: number },
): Promise<HealthWaitResult> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = await fetchVersion(baseUrl);
    if (last !== null && (version === undefined || last === version)) {
      return { ok: true, version: last };
    }
    await sleep(500);
  }
  const seconds = Math.round(timeoutMs / 1000);
  return {
    ok: false,
    reason:
      last === null
        ? `o sistema não respondeu em ${seconds} s`
        : `respondeu a versão ${last}, esperada ${version ?? "?"}`,
  };
}

/** #26: waits until nothing answers any more (after parar). */
export async function waitForStop(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchVersion(baseUrl)) === null) return true;
    await sleep(500);
  }
  return false;
}
