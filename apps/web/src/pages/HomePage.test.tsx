import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "@/App";

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

let unclosed: string[];
let backupStatus: unknown;
let healthBody: Record<string, unknown>;
let exportStatus: Record<string, unknown>;
/** FR-30: the answer of POST /api/exports/retry ("Tentar agora"). */
let retryAnswer: Record<string, unknown>;
const retryCalls: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  unclosed = [];
  healthBody = {
    status: "ok",
    version: "0.1.0",
    serverTime: "2026-11-18T22:10:00.000Z",
    db: { sqliteVersion: "3.54.1", journalMode: "wal", settingsCount: 0 },
    trial: false,
    checks: [],
  };
  exportStatus = { enabled: true, items: [], hasFailures: false };
  retryAnswer = exportStatus;
  retryCalls.length = 0;
  backupStatus = {
    configured: true,
    folder: "C:\\OneDrive\\Color\\_backup-sistema",
    lastSuccess: null,
    lastFailure: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/exports/retry") && init?.method === "POST") {
        retryCalls.push(url);
        return json(retryAnswer);
      }
      if (url.startsWith("/api/exports/status")) return json(exportStatus);
      if (url.startsWith("/api/days/unclosed")) return json({ days: unclosed });
      if (url.startsWith("/api/backup/status")) return json(backupStatus);
      if (url.startsWith("/api/health")) return json(healthBody);
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

  it("#25/#20: no OneDrive folder configured, with a link to Configurações", async () => {
    backupStatus = { configured: false, folder: null, lastSuccess: null, lastFailure: null };
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText(
        "Pasta do OneDrive não configurada: os backups não estão sendo gravados.",
      ),
    ).toBeInTheDocument();
    // #20: the notice links to Configurações, where the folder is set (FR-33).
    expect(within(alerts).getByRole("link", { name: "Configurar" })).toHaveAttribute(
      "href",
      "/configuracoes",
    );
  });

  it("#26/#20: in trial mode, no 'não configurada' prompt and no Configurar link", async () => {
    backupStatus = { configured: false, folder: null, lastSuccess: null, lastFailure: null };
    healthBody = { ...healthBody, trial: true };
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText("Modo treino: sem backup no OneDrive."),
    ).toBeInTheDocument();
    expect(within(alerts).queryByText(/não configurada/)).not.toBeInTheDocument();
    expect(within(alerts).queryByRole("link", { name: "Configurar" })).not.toBeInTheDocument();
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

describe("#26: Início shows the startup checks", () => {
  it("#26: lists each check with its status", async () => {
    healthBody.checks = [
      {
        id: "timeZone",
        status: "ok",
        message: "Fuso horário do PC: UTC−03:00, o mesmo de São Paulo.",
      },
      {
        id: "clock",
        status: "error",
        message: "O relógio do PC está atrasado: acerte a data e a hora do Windows.",
      },
      { id: "oneDriveFolder", status: "warning", message: "Pasta do OneDrive não configurada." },
    ];
    renderAt("/");
    const list = await screen.findByRole("list", { name: "Verificações" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("OK: Fuso horário do PC: UTC−03:00, o mesmo de São Paulo.");
    expect(items[1]).toHaveTextContent(
      "Erro: O relógio do PC está atrasado: acerte a data e a hora do Windows.",
    );
    expect(items[2]).toHaveTextContent("Atenção: Pasta do OneDrive não configurada.");
  });

  it("#26: no list when the server sends no checks", async () => {
    renderAt("/");
    expect(await screen.findByText("Versão")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Verificações" })).not.toBeInTheDocument();
  });
});

const failedItem = {
  id: 1,
  kind: "daily_spreadsheet",
  reference: "2026-11-17",
  status: "failed",
  attempts: 3,
  fileName: "Diária 2026-11-17.xlsx",
  lastError:
    "O arquivo Diária 2026-11-17.xlsx está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo",
  lastErrorCause: "file_in_use",
  createdAt: "2026-11-17T22:00:00.000Z",
  lastAttemptAt: "2026-11-18T13:05:00.000Z",
};

describe("FR-30: Início shows the exports that could not be written", () => {
  it("FR-30: a failed export shows Backup pendente with the file, the reason and the next try", async () => {
    exportStatus = { enabled: true, items: [failedItem], hasFailures: true };
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    const notice = await within(alerts).findByRole("group", { name: "Backup pendente" });
    expect(notice).toHaveTextContent(
      "Backup pendente: 1 planilha não foi gravada no OneDrive. Nova tentativa a cada 5 minutos.",
    );
    expect(notice).toHaveTextContent(
      "Diária 2026-11-17.xlsx: O arquivo Diária 2026-11-17.xlsx está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo. Última tentativa em 18/11/2026 10:05.",
    );
    // The file is the problem, not the folder: no link to Configurações.
    expect(within(notice).queryByRole("link")).toBeNull();
  });

  it("FR-30: a folder problem links to Configurações (spec §7.4)", async () => {
    exportStatus = {
      enabled: true,
      hasFailures: true,
      items: [
        {
          ...failedItem,
          lastError:
            "A pasta do OneDrive não existe: D:\\OneDrive. Verifique a pasta em Configurações",
          lastErrorCause: "folder",
        },
      ],
    };
    renderAt("/");
    const notice = await screen.findByRole("group", { name: "Backup pendente" });
    expect(within(notice).getByRole("link", { name: "Verificar a pasta" })).toHaveAttribute(
      "href",
      "/configuracoes",
    );
  });

  it("FR-30: Tentar agora retries now, and the alert goes away when it works", async () => {
    exportStatus = { enabled: true, items: [failedItem], hasFailures: true };
    retryAnswer = { enabled: true, items: [], hasFailures: false };
    renderAt("/");
    // A real <button>: reachable with Tab and pressed with Enter (NFR-05).
    const button = await screen.findByRole("button", { name: "Tentar agora" });
    expect(button.tagName).toBe("BUTTON");
    fireEvent.click(button);
    await vi.waitFor(() => expect(retryCalls).toEqual(["/api/exports/retry"]));
    await vi.waitFor(() =>
      expect(screen.queryByRole("group", { name: "Backup pendente" })).toBeNull(),
    );
  });

  it("FR-30: when Tentar agora fails again, it says so", async () => {
    exportStatus = { enabled: true, items: [failedItem], hasFailures: true };
    retryAnswer = { enabled: true, items: [{ ...failedItem, attempts: 4 }], hasFailures: true };
    renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Tentar agora" }));
    expect(
      await screen.findByText("Ainda não foi possível gravar. Verifique o motivo acima."),
    ).toBeInTheDocument();
  });

  it("FR-30: the still-failing message goes away when the list is refreshed", async () => {
    exportStatus = { enabled: true, items: [failedItem], hasFailures: true };
    retryAnswer = { enabled: true, items: [failedItem], hasFailures: true };
    const { container, queryClient } = renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Tentar agora" }));
    const message = "Ainda não foi possível gravar. Verifique o motivo acima.";
    expect(await screen.findByText(message)).toBeInTheDocument();

    // The server wrote one file and another one failed; the list is refreshed.
    exportStatus = {
      enabled: true,
      items: [{ ...failedItem, id: 2, fileName: "Diária 2026-11-18.xlsx" }],
      hasFailures: true,
    };
    await queryClient.invalidateQueries({ queryKey: ["exports", "status"] });
    await vi.waitFor(() => expect(container).toHaveTextContent("Diária 2026-11-18.xlsx:"));
    expect(screen.queryByText(message)).toBeNull();
  });

  it("FR-30: nothing pending, no notice", async () => {
    renderAt("/");
    await screen.findByRole("region", { name: "Alertas" });
    await screen.findByText("Nenhum dia anterior pendente de fechamento.");
    expect(screen.queryByRole("group", { name: "Backup pendente" })).toBeNull();
  });
});
