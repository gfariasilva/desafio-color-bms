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

let alerts: Record<string, unknown>;
let backupStatus: unknown;
let healthBody: Record<string, unknown>;
let exportStatus: Record<string, unknown>;
/** FR-30: the answer of POST /api/exports/retry ("Tentar agora"). */
let retryAnswer: Record<string, unknown>;
const retryCalls: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const NO_ALERTS = {
  today: "2026-11-18",
  dueSoonDays: 3,
  overdueBills: [],
  dueSoonBills: [],
  unclosedDays: [],
  cashDifference: null,
};

beforeEach(() => {
  alerts = { ...NO_ALERTS };
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
    lastRestore: null,
    startId: "s1",
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
      if (url.startsWith("/api/alerts")) return json(alerts);
      if (url.startsWith("/api/backup/status")) return json(backupStatus);
      if (url.startsWith("/api/health")) return json(healthBody);
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const LUZ = {
  id: 7,
  label: "Luz",
  referenceMonth: "2026-11",
  dueDate: "2026-11-20",
  expectedAmountCents: 20000,
};

describe("FR-27: Início alerts", () => {
  it("FR-27: no active condition → Tudo em dia", async () => {
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(await within(alerts).findByText("Tudo em dia")).toBeInTheDocument();
    expect(within(alerts).queryByRole("listitem")).toBeNull();
  });

  it("FR-27: Dia não fechado: each earlier day open, with a link to close it", async () => {
    alerts = { ...NO_ALERTS, unclosedDays: ["2026-11-14", "2026-11-17"] };
    renderAt("/");
    const region = await screen.findByRole("region", { name: "Alertas" });
    expect(await within(region).findByText("Dia 14/11/2026 não fechado")).toBeInTheDocument();
    expect(within(region).getByText("Dia 17/11/2026 não fechado")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Fechar o dia 14/11/2026" })).toHaveAttribute(
      "href",
      "/fechamento?data=2026-11-14",
    );
    expect(within(region).queryByText("Tudo em dia")).toBeNull();
  });

  it("FR-27: Conta vencida, with the month and a link that opens the payment", async () => {
    alerts = {
      ...NO_ALERTS,
      overdueBills: [{ ...LUZ, referenceMonth: "2026-10", dueDate: "2026-10-20" }],
    };
    renderAt("/");
    const row = (await screen.findByText(/Conta vencida:/)).closest("li")!;
    expect(row).toHaveTextContent(
      "Conta vencida: Luz (10/2026), venceu há 29 dias (20/10/2026) · previsto R$ 200,00",
    );
    expect(within(row).getByRole("link", { name: "Pagar Luz (10/2026)" })).toHaveAttribute(
      "href",
      "/despesas-fixas/mes?mes=2026-10&pagar=7",
    );
  });

  it("FR-27: Conta a vencer, without an expected amount", async () => {
    alerts = { ...NO_ALERTS, dueSoonBills: [{ ...LUZ, expectedAmountCents: null }] };
    renderAt("/");
    const row = (await screen.findByText(/Conta a vencer:/)).closest("li")!;
    // The current month is not repeated.
    expect(row).toHaveTextContent("Conta a vencer: Luz, vence em 2 dias (20/11/2026)");
    expect(row).not.toHaveTextContent("previsto");
    expect(within(row).getByRole("link", { name: "Pagar Luz" })).toHaveAttribute(
      "href",
      "/despesas-fixas/mes?mes=2026-11&pagar=7",
    );
  });

  it("FR-27: Diferença de caixa in the last closing, with a link to it", async () => {
    alerts = {
      ...NO_ALERTS,
      cashDifference: { date: "2026-11-17", differenceCents: -500, limitCents: 0 },
    };
    renderAt("/");
    const row = (await screen.findByText(/Diferença de caixa/)).closest("li")!;
    expect(row).toHaveTextContent(
      "Diferença de caixa no fechamento de 17/11/2026: Falta de R$ 5,00",
    );
    // The default limit R$ 0,00 (A-17) is not worth repeating.
    expect(row).not.toHaveTextContent("limite");
    expect(
      within(row).getByRole("link", { name: "Ver o fechamento de 17/11/2026" }),
    ).toHaveAttribute("href", "/fechamento?data=2026-11-17");
  });

  it("FR-27/FR-33: a configured limit is shown with the difference", async () => {
    alerts = {
      ...NO_ALERTS,
      cashDifference: { date: "2026-11-17", differenceCents: 1200, limitCents: 1000 },
    };
    renderAt("/");
    const row = (await screen.findByText(/Diferença de caixa/)).closest("li")!;
    expect(row).toHaveTextContent(
      "Diferença de caixa no fechamento de 17/11/2026: Sobra de R$ 12,00 (limite R$ 10,00)",
    );
  });

  it("FR-27: the alerts come in order of urgency", async () => {
    alerts = {
      ...NO_ALERTS,
      dueSoonBills: [LUZ],
      overdueBills: [{ ...LUZ, id: 8, label: "Água", dueDate: "2026-11-10" }],
      unclosedDays: ["2026-11-17"],
      cashDifference: { date: "2026-11-16", differenceCents: -500, limitCents: 0 },
    };
    renderAt("/");
    const region = await screen.findByRole("region", { name: "Alertas" });
    await within(region).findByText("Dia 17/11/2026 não fechado");
    const rows = within(region)
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(rows.map((text) => text.split(/[:\s]/)[0])).toEqual([
      "Dia",
      "Conta",
      "Diferença",
      "Conta",
    ]);
    expect(rows[1]).toMatch(/^Conta vencida/);
    expect(rows[3]).toMatch(/^Conta a vencer/);
  });

  it("#26: a startup check in error is an alert, with a link to Configurações", async () => {
    healthBody.checks = [
      { id: "timeZone", status: "ok", message: "Fuso horário do PC: UTC−03:00." },
      {
        id: "clock",
        status: "error",
        message: "O relógio do PC está atrasado: acerte a data e a hora do Windows.",
      },
    ];
    renderAt("/");
    const row = (await screen.findByText(/Problema no PC:/)).closest("li")!;
    expect(row).toHaveTextContent(
      "Problema no PC: O relógio do PC está atrasado: acerte a data e a hora do Windows.",
    );
    expect(within(row).getByRole("link", { name: "Ver detalhes" })).toHaveAttribute(
      "href",
      "/configuracoes",
    );
    // An OK check is not an alert.
    expect(screen.queryByText(/Fuso horário/)).toBeNull();
    expect(screen.queryByText("Tudo em dia")).toBeNull();
  });

  it("FR-27: a failed alerts request is shown, never Tudo em dia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/alerts")) return json({ error: "erro" }, 500);
        if (url.startsWith("/api/exports/status")) return json(exportStatus);
        if (url.startsWith("/api/backup/status")) return json(backupStatus);
        if (url.startsWith("/api/health")) return json(healthBody);
        return json({ error: "not found" }, 404);
      }),
    );
    renderAt("/");
    expect(await screen.findByText("Não foi possível verificar os alertas.")).toBeInTheDocument();
    expect(screen.queryByText("Tudo em dia")).toBeNull();
  });
});

describe("FR-27: Início shortcuts", () => {
  it("FR-27: register a sale, register an expense and close the day", async () => {
    renderAt("/");
    const shortcuts = await screen.findByRole("region", { name: "Atalhos" });
    const links = within(shortcuts).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Registrar vendaAlt+2", "/vendas"],
      ["Registrar despesaAlt+3", "/despesas"],
      ["Fechar o diaAlt+5", "/fechamento"],
    ]);
    // NFR-05: the keyboard shortcut is announced, not only drawn.
    expect(within(shortcuts).getByRole("link", { name: "Registrar venda" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+2",
    );
  });

  it("FR-27: the system status moved to Configurações", async () => {
    renderAt("/");
    await screen.findByRole("region", { name: "Alertas" });
    expect(screen.queryByText("Status do sistema")).toBeNull();
  });
});

describe("#25 / #22: Início shows the state of the backup", () => {
  it("FR-31: a failed backup is in the same Backup pendente notice as the spreadsheets (FR-30)", async () => {
    exportStatus = {
      enabled: true,
      hasFailures: true,
      items: [
        {
          ...failedItem,
          kind: "db_backup",
          reference: "2026-11-18",
          fileName: "Backup do banco 2026-11-18",
          lastError:
            "A pasta do OneDrive não existe: C:\\OneDrive\\Color. Verifique a pasta em Configurações",
          lastErrorCause: "folder",
        },
      ],
    };
    renderAt("/");
    const notice = await screen.findByRole("group", { name: "Backup pendente" });
    expect(notice).toHaveTextContent(
      "Backup pendente: o backup do banco não foi gravado no OneDrive. Nova tentativa a cada 5 minutos.",
    );
    expect(notice).toHaveTextContent(
      "Backup do banco 2026-11-18: A pasta do OneDrive não existe: C:\\OneDrive\\Color. Verifique a pasta em Configurações.",
    );
    expect(within(notice).getByRole("link", { name: "Verificar a pasta" })).toBeInTheDocument();
    // #22: no second, separate backup notice.
    expect(screen.getAllByText(/Backup pendente:/)).toHaveLength(1);
  });

  it("FR-31: a failed backup and spreadsheets are summed up together", async () => {
    exportStatus = {
      enabled: true,
      hasFailures: true,
      items: [
        failedItem,
        { ...failedItem, id: 2, kind: "db_backup", fileName: "Backup do banco 2026-11-18" },
      ],
    };
    renderAt("/");
    const notice = await screen.findByRole("group", { name: "Backup pendente" });
    expect(notice).toHaveTextContent(
      "Backup pendente: 1 planilha e o backup do banco não foram gravados no OneDrive.",
    );
  });

  it("#25: a failed status request is shown, not hidden", async () => {
    backupStatus = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/alerts")) return json(NO_ALERTS);
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
    backupStatus = {
      configured: false,
      folder: null,
      lastSuccess: null,
      lastRestore: null,
      startId: "s1",
    };
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
    expect(within(alerts).queryByText("Tudo em dia")).toBeNull();
  });

  it("#26/#20: in trial mode, no 'não configurada' prompt and no Configurar link", async () => {
    backupStatus = {
      configured: false,
      folder: null,
      lastSuccess: null,
      lastRestore: null,
      startId: "s1",
    };
    healthBody = { ...healthBody, trial: true };
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText("Modo treino: sem backup no OneDrive."),
    ).toBeInTheDocument();
    expect(within(alerts).queryByText(/não configurada/)).not.toBeInTheDocument();
    expect(within(alerts).queryByRole("link", { name: "Configurar" })).not.toBeInTheDocument();
    // #26: trial mode is a note, not an alert.
    expect(within(alerts).getByText("Tudo em dia")).toBeInTheDocument();
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
    expect(within(alerts).queryByText("Tudo em dia")).toBeNull();
    expect(notice).toHaveTextContent(
      "Backup pendente: 1 planilha não foi gravada no OneDrive. Nova tentativa a cada 5 minutos.",
    );
    expect(notice).toHaveTextContent(
      "Diária 2026-11-17.xlsx: O arquivo Diária 2026-11-17.xlsx está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo. Última tentativa em 18/11/2026 10:05.",
    );
    // The file is the problem, not the folder: no link to Configurações.
    expect(within(notice).queryByRole("link")).toBeNull();
  });

  it("FR-29: a failed monthly spreadsheet is listed with the daily one", async () => {
    exportStatus = {
      enabled: true,
      hasFailures: true,
      items: [
        failedItem,
        {
          ...failedItem,
          id: 2,
          kind: "monthly_spreadsheet",
          reference: "2026-11",
          fileName: "Mensal 2026-11.xlsx",
          lastError:
            "O arquivo Mensal 2026-11.xlsx está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo",
        },
      ],
    };
    renderAt("/");
    const notice = await screen.findByRole("group", { name: "Backup pendente" });
    expect(notice).toHaveTextContent(
      "Backup pendente: 2 planilhas não foram gravadas no OneDrive.",
    );
    expect(notice).toHaveTextContent(
      "Mensal 2026-11.xlsx: O arquivo Mensal 2026-11.xlsx está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo. Última tentativa em 18/11/2026 10:05.",
    );
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
    await screen.findByText("Tudo em dia");
    expect(screen.queryByRole("group", { name: "Backup pendente" })).toBeNull();
  });
});
