import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "@/App";

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let unclosed: string[];
let backupStatus: unknown;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  unclosed = [];
  backupStatus = {
    configured: true,
    folder: "C:\\OneDrive\\Color\\_backup-sistema",
    lastSuccess: null,
    lastFailure: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/days/unclosed")) return json({ days: unclosed });
      if (url.startsWith("/api/backup/status")) return json(backupStatus);
      if (url.startsWith("/api/health")) {
        return json({
          status: "ok",
          version: "0.1.0",
          serverTime: "2026-11-18T22:10:00.000Z",
          db: { sqliteVersion: "3.54.1", journalMode: "wal", settingsCount: 0 },
        });
      }
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FR-27 (pilot slice): Início warns about days left open", () => {
  it("FR-27: lists each earlier day with movement still open, with a link to close it", async () => {
    unclosed = ["2026-11-14", "2026-11-17"];
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(await within(alerts).findByText("Dia 14/11/2026 não fechado")).toBeInTheDocument();
    expect(within(alerts).getByText("Dia 17/11/2026 não fechado")).toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: "Fechar o dia 14/11/2026" })).toHaveAttribute(
      "href",
      "/fechamento?data=2026-11-14",
    );
  });

  it("FR-27: no pending day", async () => {
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText("Nenhum dia anterior pendente de fechamento."),
    ).toBeInTheDocument();
  });
});

describe("#25: Início shows the state of the backup", () => {
  it('#25: a failed backup shows "Backup pendente" with the reason', async () => {
    backupStatus = {
      configured: true,
      folder: "C:\\OneDrive\\Color\\_backup-sistema",
      lastSuccess: null,
      lastFailure: {
        at: "2026-11-18T22:03:00.000Z",
        trigger: "day-close",
        message: "A pasta do OneDrive não existe: C:\\OneDrive\\Color",
      },
    };
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    // "Backup pendente:" is in bold, so the sentence spans two elements.
    const notice = await within(alerts).findByText(
      (_, element) =>
        element?.tagName === "SPAN" && /^Backup pendente:/.test(element.textContent ?? ""),
    );
    expect(notice).toHaveTextContent(
      "Backup pendente: A pasta do OneDrive não existe: C:\\OneDrive\\Color. Tentativa em 18/11/2026 19:03. Nova tentativa no próximo fechamento do dia ou ao reiniciar o sistema.",
    );
  });

  it("#25: a failed status request is shown, not hidden", async () => {
    backupStatus = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/days/unclosed")) return json({ days: [] });
        return json({ error: "erro" }, 500);
      }),
    );
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText("Não foi possível verificar o backup."),
    ).toBeInTheDocument();
  });

  it("#25: no OneDrive folder configured", async () => {
    backupStatus = { configured: false, folder: null, lastSuccess: null, lastFailure: null };
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText(
        "Pasta do OneDrive não configurada: os backups não estão sendo gravados.",
      ),
    ).toBeInTheDocument();
  });

  it("#25: the system status shows the time of the last backup", async () => {
    backupStatus = {
      configured: true,
      folder: "C:\\OneDrive\\Color\\_backup-sistema",
      lastSuccess: { at: "2026-11-18T22:03:00.000Z", file: "color-2026-11-18_1903.db" },
      lastFailure: null,
    };
    renderAt("/");
    expect(await screen.findByText("Último backup")).toBeInTheDocument();
    expect(await screen.findByText("18/11/2026 19:03")).toBeInTheDocument();
  });
});
