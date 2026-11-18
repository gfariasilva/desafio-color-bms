import type { FastifyInstance } from "fastify";

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(hostHeader: string): string {
  // "localhost:3210" → "localhost"; "[::1]:3210" → "[::1]"
  return hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : (hostHeader.split(":")[0] ?? "");
}

function isAllowedOrigin(origin: string): boolean {
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).host.replace(/:\d+$/, ""));
  } catch {
    return false;
  }
}

/**
 * There is no login (NFR-08), so we must stop other web pages open in the owner's browser
 * from talking to this server (ADR 0001, risk table):
 * - Host must be localhost/127.0.0.1 → blocks DNS-rebinding attacks.
 * - Origin, when the browser sends one, must also be local → blocks cross-site requests.
 */
export function registerHostGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    if (!ALLOWED_HOSTNAMES.has(hostnameOf(host)) || (origin && !isAllowedOrigin(origin))) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });
}
