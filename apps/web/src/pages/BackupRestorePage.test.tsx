import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTER_FUTURE } from "@/App";
import { BackupRestorePage } from "./BackupRestorePage";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ONE_DRIVE = "C:\\OneDrive\\Color\\_backup-sistema";
let status: Record<string, unknown>;
let files: Record<string, unknown>;
let restoreAnswer: () => Response;
let uploadAnswer: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

function calls(method: string, prefix: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => String(input).startsWith(prefix) && (init?.method ?? "GET") === method,
  );
}

/** Types the reason and submits the confirmation (Enter in the field submits the form). */
function typeReasonAndSubmit(reason: string) {
  fireEvent.change(screen.getByLabelText("Motivo da restauração"), { target: { value: reason } });
  fireEvent.submit(screen.getByRole("form", { name: "Restaurar o backup" }));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/configuracoes/backup"]} future={ROUTER_FUTURE}>
        <BackupRestorePage restartPollMs={10} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  status = {
    configured: true,
    folder: ONE_DRIVE,
    lastSuccess: { at: "2026-11-18T18:00:00.000Z", file: "color-2026-11-18_1500.db" },
    lastRestore: null,
    startId: "s1",
  };
  files = {
    oneDriveFolder: ONE_DRIVE,
    localFolder: "C:\\dados\\backups",
    backups: [
      {
        source: "onedrive",
        name: "color-2026-11-18_1500.db",
        date: "2026-11-18",
        time: "15:00",
        at: "2026-11-18T18:00:00.000Z",
        sizeBytes: 1536,
      },
      {
        source: "local",
        name: "color-2026-11-10_0900.db",
        date: "2026-11-10",
        time: "09:00",
        at: "2026-11-10T12:00:00.000Z",
        sizeBytes: 2 * 1024 * 1024,
      },
    ],
  };
  restoreAnswer = () => json({ restarting: true, startId: "s1" }, 202);
  uploadAnswer = () =>
    json({ name: "color-2026-11-01_1900.db", sizeBytes: 4096, at: "2026-11-01T22:00:00.000Z" });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/backup/status") return json(status);
    if (url === "/api/backup/files") return json(files);
    if (url === "/api/backup/restore" && method === "POST") return restoreAnswer();
    if (url.startsWith("/api/backup/upload") && method === "PUT") return uploadAnswer();
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FR-32: Backup e restauração", () => {
  it("FR-31: shows the folder and the last backup", async () => {
    renderPage();
    expect(await screen.findByText(ONE_DRIVE)).toBeInTheDocument();
    expect(screen.getByText("Último backup")).toBeInTheDocument();
    expect(await screen.findAllByText("18/11/2026 15:00")).not.toHaveLength(0);
  });

  it("FR-32: lists the backups with date, time, origin and size", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Backups disponíveis" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("18/11/2026");
    expect(rows[1]).toHaveTextContent("15:00");
    expect(rows[1]).toHaveTextContent("OneDrive");
    expect(rows[1]).toHaveTextContent("1,5 KB");
    expect(rows[2]).toHaveTextContent("Este PC");
    expect(rows[2]).toHaveTextContent("2 MB");
  });

  it("FR-32: no backups → says so", async () => {
    files = { ...files, backups: [] };
    renderPage();
    expect(await screen.findByText("Nenhum backup encontrado.")).toBeInTheDocument();
  });

  it("FR-32: Restaurar asks 'Tem certeza?' with a reason; the reason is required", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Restaurar o backup de 18/11/2026 15:00 (OneDrive)",
      }),
    );
    const form = screen.getByRole("form", { name: "Restaurar o backup" });
    expect(form).toHaveTextContent("Tem certeza?");
    expect(form).toHaveTextContent("O sistema volta ao estado de 18/11/2026 15:00");
    const reason = within(form).getByLabelText("Motivo da restauração");
    expect(reason).toHaveFocus();

    fireEvent.submit(screen.getByRole("form", { name: "Restaurar o backup" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Informe o motivo da restauração.",
    );
    expect(calls("POST", "/api/backup/restore")).toHaveLength(0);
  });

  it("FR-32: Esc cancels and focus returns to the Restaurar button", async () => {
    renderPage();
    const button = await screen.findByRole("button", {
      name: "Restaurar o backup de 10/11/2026 09:00 (Este PC)",
    });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("Motivo da restauração"), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Restaurar o backup" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("FR-32: confirming restores, waits for the restart and shows the result", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Restaurar o backup de 18/11/2026 15:00 (OneDrive)",
      }),
    );
    typeReasonAndSubmit("Lançamentos errados");

    expect(await screen.findByText(/Restaurando o backup/)).toBeInTheDocument();
    const [call] = calls("POST", "/api/backup/restore");
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      source: "onedrive",
      name: "color-2026-11-18_1500.db",
      reason: "Lançamentos errados",
    });

    // The server is back with a new start id and the restore's result.
    status = {
      ...status,
      startId: "s2",
      lastRestore: {
        ok: true,
        at: "2026-11-18T18:05:00.000Z",
        file: "color-2026-11-18_1500.db",
        message: "Backup de 18/11/2026 15:00 restaurado.",
      },
    };
    expect(await screen.findByText("Backup de 18/11/2026 15:00 restaurado.")).toBeInTheDocument();
    expect(screen.queryByText(/Restaurando o backup/)).not.toBeInTheDocument();
  });

  it("FR-32: a refusal from the server is shown in the confirmation", async () => {
    restoreAnswer = () =>
      json(
        {
          error:
            "Este backup foi feito por uma versão mais nova do sistema. Atualize o sistema antes de restaurar.",
        },
        400,
      );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Restaurar o backup de 18/11/2026 15:00 (OneDrive)",
      }),
    );
    typeReasonAndSubmit("x");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este backup foi feito por uma versão mais nova do sistema.",
    );
  });

  it("FR-32: a failed restore at the restart is shown", async () => {
    status = {
      ...status,
      lastRestore: {
        ok: false,
        at: "2026-11-18T18:05:00.000Z",
        file: "color-2026-11-18_1500.db",
        message: "Não foi possível salvar a cópia de segurança do banco atual. Nada foi alterado.",
      },
    };
    renderPage();
    expect(
      await screen.findByText(
        "Não foi possível salvar a cópia de segurança do banco atual. Nada foi alterado.",
      ),
    ).toBeInTheDocument();
  });
});

describe("FR-32: restore from a file (new PC)", () => {
  it("FR-32: the chosen file is sent, then restored with a reason", async () => {
    renderPage();
    const input = await screen.findByLabelText("Arquivo de backup (.db)");
    const file = new File(["SQLite format 3"], "color-2026-11-01_1900.db");
    fireEvent.change(input, { target: { files: [file] } });

    const form = await screen.findByRole("form", { name: "Restaurar o backup" });
    expect(form).toHaveTextContent("O sistema volta ao estado de 01/11/2026 19:00");
    expect(calls("PUT", "/api/backup/upload")).toHaveLength(1);
    expect(String(calls("PUT", "/api/backup/upload")[0]?.[0])).toBe(
      "/api/backup/upload?name=color-2026-11-01_1900.db",
    );
    typeReasonAndSubmit("PC novo");
    await waitFor(() => expect(calls("POST", "/api/backup/restore")).toHaveLength(1));
    expect(
      JSON.parse(String((calls("POST", "/api/backup/restore")[0]?.[1] as RequestInit).body)),
    ).toEqual({ source: "upload", reason: "PC novo" });
  });

  it("FR-32: a file that is not a backup is refused with the server's message", async () => {
    uploadAnswer = () =>
      json({ error: "Este arquivo não é um backup do sistema Color. Escolha outro arquivo." }, 400);
    renderPage();
    const input = await screen.findByLabelText("Arquivo de backup (.db)");
    fireEvent.change(input, { target: { files: [new File(["x"], "planilha.xlsx")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este arquivo não é um backup do sistema Color. Escolha outro arquivo.",
    );
    expect(screen.queryByRole("form", { name: "Restaurar o backup" })).not.toBeInTheDocument();
  });
});
