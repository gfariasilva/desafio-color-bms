import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "@/App";

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/configuracoes"]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FOLDER = "C:\\Users\\dono\\OneDrive\\Color";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let settings: Record<string, unknown>;
let putResponse: () => Response;
let testResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;
/** GET /api/health and GET /api/backup/status: the system status card (#25, #26). */
let healthBody: Record<string, unknown> | null;
let backupStatus: Record<string, unknown> | null;

function requestsTo(method: string, url: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => String(input) === url && (init?.method ?? "GET") === method,
  );
}

function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as unknown;
}

beforeEach(() => {
  settings = {
    oneDriveFolder: FOLDER,
    cashDifferenceLimitCents: 0,
    dueSoonDays: 3,
    oneDriveFolderSource: "settings",
    trial: false,
  };
  putResponse = () => json(settings);
  testResponse = () =>
    json({ ok: true, message: `Pasta OK: o sistema consegue gravar em ${FOLDER}.` });
  healthBody = null;
  backupStatus = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/health" && healthBody) return json(healthBody);
    if (url === "/api/backup/status" && backupStatus) return json(backupStatus);
    if (url === "/api/settings" && method === "GET") return json(settings);
    if (url === "/api/settings" && method === "PUT") return putResponse();
    if (url === "/api/settings/onedrive-folder/test") return testResponse();
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Types a value, like the owner would (one change event). */
function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

/** Enter in any field submits the form (a native form submit). */
function pressEnter() {
  fireEvent.submit(screen.getByRole("form", { name: "Configurações" }));
}

async function loaded() {
  renderSettings();
  const folder = await screen.findByLabelText("Pasta do OneDrive");
  await waitFor(() => expect(folder).toHaveValue(FOLDER));
  return folder;
}

describe("FR-33: Configurações form", () => {
  it("FR-33: shows the stored values, money as R$ text, focus on the folder", async () => {
    const folder = await loaded();
    expect(screen.getByLabelText("Limite da diferença de caixa (R$)")).toHaveValue("0,00");
    expect(screen.getByLabelText("Antecedência das contas a vencer (dias)")).toHaveValue("3");
    expect(folder).toHaveFocus();
  });

  it("FR-33: Enter saves the values and focus returns to the first field", async () => {
    const folder = await loaded();
    const limit = screen.getByLabelText("Limite da diferença de caixa (R$)");
    const days = screen.getByLabelText("Antecedência das contas a vencer (dias)");
    type(limit, "5,50");
    type(days, "7");
    pressEnter();

    expect(await screen.findByText("Configurações salvas.")).toBeInTheDocument();
    const [put] = requestsTo("PUT", "/api/settings");
    expect(bodyOf(put!)).toEqual({
      oneDriveFolder: FOLDER,
      cashDifferenceLimitCents: 550,
      dueSoonDays: 7,
    });
    expect(folder).toHaveFocus();
  });

  it("FR-33: an unreadable amount is refused on the client with a pt-BR message", async () => {
    await loaded();
    const limit = screen.getByLabelText("Limite da diferença de caixa (R$)");
    type(limit, "abc");
    pressEnter();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o limite em reais, por exemplo 10,00.",
    );
    expect(requestsTo("PUT", "/api/settings")).toHaveLength(0);
    expect(limit).toHaveFocus();
  });

  it("FR-33: days outside 0–30 are refused with the shared schema's message", async () => {
    await loaded();
    const days = screen.getByLabelText("Antecedência das contas a vencer (dias)");
    type(days, "45");
    pressEnter();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A antecedência deve ser um número inteiro de dias, de 0 a 30.",
    );
    expect(requestsTo("PUT", "/api/settings")).toHaveLength(0);
  });

  it("FR-33: a folder refused by the server shows its pt-BR message", async () => {
    putResponse = () =>
      json(
        {
          error: "A pasta não existe: D:\\Nada. Confira o caminho ou crie a pasta no OneDrive.",
          code: "folder_test_failed",
        },
        422,
      );
    const folder = await loaded();
    type(folder, "D:\\Nada");
    pressEnter();

    expect(await screen.findByRole("alert")).toHaveTextContent("A pasta não existe: D:\\Nada.");
    expect(screen.queryByText("Configurações salvas.")).not.toBeInTheDocument();
  });
});

describe('FR-33: "Testar" the OneDrive folder', () => {
  it("FR-33: Testar sends the typed folder and shows the success", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Testar" }));

    expect(
      await screen.findByText(`Pasta OK: o sistema consegue gravar em ${FOLDER}.`),
    ).toBeInTheDocument();
    const [call] = requestsTo("POST", "/api/settings/onedrive-folder/test");
    expect(bodyOf(call!)).toEqual({ folder: FOLDER });
    // Testing never saves.
    expect(requestsTo("PUT", "/api/settings")).toHaveLength(0);
  });

  it("FR-33: Dado uma pasta inexistente, Quando clica em Testar, Então mostra o erro em português", async () => {
    const message = "A pasta não existe: D:\\Nada. Confira o caminho ou crie a pasta no OneDrive.";
    testResponse = () => json({ ok: false, message });
    const folder = await loaded();
    type(folder, "D:\\Nada");
    fireEvent.click(screen.getByRole("button", { name: "Testar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("FR-33: Testar with an empty folder asks for one, without calling the server", async () => {
    const folder = await loaded();
    type(folder, "");
    fireEvent.click(screen.getByRole("button", { name: "Testar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe a pasta do OneDrive.");
    expect(requestsTo("POST", "/api/settings/onedrive-folder/test")).toHaveLength(0);
  });

  it("FR-33: editing the folder clears an earlier test result", async () => {
    const folder = await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Testar" }));
    await screen.findByText(/^Pasta OK/);
    type(folder, `${FOLDER}\\2026`);
    expect(screen.queryByText(/^Pasta OK/)).not.toBeInTheDocument();
  });
});

describe("#20: special cases", () => {
  it("#20: a folder set by COLOR_BMS_ONEDRIVE_DIR is read-only, but Testar still works", async () => {
    settings = { ...settings, oneDriveFolderSource: "env" };
    const folder = await loaded();
    expect(folder).toHaveAttribute("readonly");
    expect(screen.getByText(/variável de ambiente COLOR_BMS_ONEDRIVE_DIR/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Testar" }));
    expect(await screen.findByText(/^Pasta OK/)).toBeInTheDocument();
  });

  it("#26: trial mode says nothing goes to OneDrive", async () => {
    settings = { ...settings, trial: true };
    await loaded();
    expect(
      screen.getByText("Modo treino: nada é gravado no OneDrive, qualquer que seja a pasta."),
    ).toBeInTheDocument();
  });

  it("FR-33: Auditoria is still reachable from Configurações", async () => {
    await loaded();
    expect(screen.getByRole("link", { name: /Auditoria/ })).toHaveAttribute(
      "href",
      "/configuracoes/auditoria",
    );
  });
});

const HEALTH = {
  status: "ok",
  version: "0.1.0",
  serverTime: "2026-11-18T22:10:00.000Z",
  db: { sqliteVersion: "3.54.1", journalMode: "wal", settingsCount: 0 },
  trial: false,
  checks: [],
};

describe("#23: the system status is in Configurações (moved from Início)", () => {
  it("#25: shows the version, the database and the time of the last backup", async () => {
    healthBody = HEALTH;
    backupStatus = {
      configured: true,
      folder: "C:\\OneDrive\\Color\\_backup-sistema",
      lastSuccess: { at: "2026-11-18T22:03:00.000Z", file: "color-2026-11-18_1903.db" },
      lastRestore: null,
      startId: "s1",
    };
    renderSettings();
    const status = await screen.findByRole("region", { name: "Status do sistema" });
    expect(await within(status).findByText("Conectado")).toBeInTheDocument();
    expect(within(status).getByText("0.1.0")).toBeInTheDocument();
    expect(within(status).getByText("SQLite 3.54.1 (WAL)")).toBeInTheDocument();
    expect(within(status).getByText("Último backup")).toBeInTheDocument();
    expect(within(status).getByText("18/11/2026 19:03")).toBeInTheDocument();
  });

  it("#26: lists each startup check with its status", async () => {
    healthBody = {
      ...HEALTH,
      checks: [
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
      ],
    };
    renderSettings();
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
    healthBody = HEALTH;
    renderSettings();
    expect(await screen.findByText("Versão")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Verificações" })).not.toBeInTheDocument();
  });

  it("#23: the server is unreachable", async () => {
    renderSettings();
    const status = await screen.findByRole("region", { name: "Status do sistema" });
    expect(
      await within(status).findByText(
        "Não foi possível falar com o servidor. Verifique se o sistema está em execução.",
      ),
    ).toBeInTheDocument();
  });
});
