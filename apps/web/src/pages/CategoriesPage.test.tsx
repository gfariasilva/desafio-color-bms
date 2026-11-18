import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseCategory, SaleCategory } from "@color-bms/core";
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

const saleTabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Serviços de copiadora", order: 2, active: true },
  { id: 3, name: "Recargas", order: 3, active: false },
];

const expenseCategories: ExpenseCategory[] = [
  { id: 1, name: "Alimentação", group: "general", order: 1, active: true },
  { id: 2, name: "Kalunga", group: "suppliers", order: 2, active: true },
];

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const calls: Call[] = [];
/** Answer for non-GET requests; GET returns the lists above. */
let writeResponse: () => Response;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  calls.length = 0;
  writeResponse = () => new Response(JSON.stringify(saleTabs[0]), { status: 200 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") {
      const categories = url.startsWith("/api/expense-categories") ? expenseCategories : saleTabs;
      return new Response(JSON.stringify({ categories }), { status: 200 });
    }
    return writeResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function writes(): Call[] {
  return calls.filter((call) => call.method !== "GET");
}

describe("Cadastros (FR-14)", () => {
  it("FR-14: Cadastros links to sale tabs and expense categories", () => {
    renderAt("/cadastros");
    expect(screen.getByRole("link", { name: /Abas de venda/ })).toHaveAttribute(
      "href",
      "/cadastros/abas",
    );
    expect(screen.getByRole("link", { name: /Categorias de despesa/ })).toHaveAttribute(
      "href",
      "/cadastros/categorias-despesa",
    );
  });

  it("FR-14: lists the tabs and marks the inactive one", async () => {
    renderAt("/cadastros/abas");
    const row = (await screen.findByText("Recargas")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Inativa")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole("button", { name: /Reativar/ })).toBeVisible();
  });

  it("FR-14: Enter creates a tab and focus returns to the name field", async () => {
    writeResponse = () =>
      new Response(JSON.stringify({ id: 4, name: "Encadernação", order: 4, active: true }), {
        status: 201,
      });
    renderAt("/cadastros/abas");
    await screen.findByText("Toner");
    const field = screen.getByLabelText("Nova aba");
    fireEvent.change(field, { target: { value: "Encadernação" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "POST", url: "/api/sale-categories", body: { name: "Encadernação" } },
      ]),
    );
    await waitFor(() => expect(field).toHaveValue(""));
    expect(field).toHaveFocus();
  });

  it("FR-14: blocks a duplicate name (case and accents ignored) before calling the server", async () => {
    renderAt("/cadastros/abas");
    await screen.findByText("Toner");
    const field = screen.getByLabelText("Nova aba");
    fireEvent.change(field, { target: { value: "SERVICOS DE COPIADORA" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma aba com esse nome.");
    expect(writes()).toEqual([]);
  });

  it("FR-14: shows the server's pt-BR error", async () => {
    writeResponse = () =>
      new Response(JSON.stringify({ error: "Já existe uma aba com esse nome." }), { status: 409 });
    renderAt("/cadastros/abas");
    await screen.findByText("Toner");
    const field = screen.getByLabelText("Nova aba");
    fireEvent.change(field, { target: { value: "Nova" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma aba com esse nome.");
  });

  it("FR-14: renames inline with Enter", async () => {
    renderAt("/cadastros/abas");
    fireEvent.click(await screen.findByRole("button", { name: "Renomear Serviços de copiadora" }));
    const input = screen.getByLabelText("Novo nome de Serviços de copiadora");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Cópias e impressões" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "PATCH", url: "/api/sale-categories/2", body: { name: "Cópias e impressões" } },
      ]),
    );
  });

  it("FR-14: Esc cancels a rename", async () => {
    renderAt("/cadastros/abas");
    fireEvent.click(await screen.findByRole("button", { name: "Renomear Toner" }));
    fireEvent.keyDown(screen.getByLabelText("Novo nome de Toner"), { key: "Escape" });
    expect(screen.queryByLabelText("Novo nome de Toner")).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("FR-14: moving a tab down sends the new order", async () => {
    renderAt("/cadastros/abas");
    fireEvent.click(await screen.findByRole("button", { name: "Mover Toner para baixo" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "PUT", url: "/api/sale-categories/order", body: { ids: [2, 1, 3] } },
      ]),
    );
  });

  it("FR-14: deleting a used tab is blocked and offers to deactivate it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    writeResponse = () =>
      new Response(
        JSON.stringify({
          error: "Esta aba já tem lançamentos e não pode ser excluída. Desative-a.",
          code: "category_in_use",
        }),
        { status: 409 },
      );
    renderAt("/cadastros/abas");
    fireEvent.click(await screen.findByRole("button", { name: "Excluir Toner" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("não pode ser excluída");
    writeResponse = () => new Response(JSON.stringify(saleTabs[0]), { status: 200 });
    fireEvent.click(within(alert).getByRole("button", { name: "Desativar Toner" }));
    await waitFor(() =>
      expect(writes().at(-1)).toEqual({
        method: "PATCH",
        url: "/api/sale-categories/1",
        body: { active: false },
      }),
    );
  });

  it("FR-14: expense categories are shown by group, and a new one takes a group", async () => {
    writeResponse = () =>
      new Response(
        JSON.stringify({ id: 3, name: "Tilibra", group: "suppliers", order: 3, active: true }),
        { status: 201 },
      );
    renderAt("/cadastros/categorias-despesa");
    expect(await screen.findByRole("heading", { name: "Geral" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fornecedores de materiais" })).toBeInTheDocument();

    const field = screen.getByLabelText("Nova categoria");
    fireEvent.change(field, { target: { value: "Tilibra" } });
    fireEvent.change(screen.getByLabelText("Grupo"), { target: { value: "suppliers" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          url: "/api/expense-categories",
          body: { name: "Tilibra", group: "suppliers" },
        },
      ]),
    );
  });
});
