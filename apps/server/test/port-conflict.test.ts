import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { identifyPortOwner } from "../src/startup/port-conflict";

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function serve(handler: http.RequestListener): Promise<number> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

describe("#26: port 3210 already in use at startup", () => {
  it("#26: recognises another instance of this system by its health page", async () => {
    const port = await serve((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "ok", version: "0.1.0", serverTime: "x", db: {} }));
    });
    expect(await identifyPortOwner(port)).toBe("color-bms");
  });

  it("#26: another program on the port is reported as such", async () => {
    const port = await serve((_request, response) => response.end("<html>other</html>"));
    expect(await identifyPortOwner(port)).toBe("other");
  });

  it("#26: nothing listening", async () => {
    const port = await serve(() => {});
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    expect(await identifyPortOwner(port)).toBe("none");
  });
});
