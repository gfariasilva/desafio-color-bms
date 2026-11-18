import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditListResponse } from "@color-bms/core";
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

const editedSale: AuditListResponse = {
  entries: [
    {
      id: 7,
      at: "2026-11-18T22:03:00.000Z",
      entity: "sale",
      entityId: "42",
      action: "update",
      before: { grossCents: 5000 },
      after: { grossCents: 500 },
      reason: "Valor digitado errado",
    },
  ],
  hasMore: false,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  // Reset per test: some tests replace the response with mockImplementation.
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify(editedSale), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Testing Library collapses whitespace in the page text (formatCents' non-breaking space
// becomes a normal space), so expected money strings here use a normal space.

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe("Auditoria page (FR-18)", () => {
  it("FR-18: Configurações links to the audit log", () => {
    renderAt("/configuracoes");
    expect(screen.getByRole("link", { name: /Auditoria/ })).toHaveAttribute(
      "href",
      "/configuracoes/auditoria",
    );
  });

  it("FR-18: shows an edited sale with its before and after values", async () => {
    renderAt("/configuracoes/auditoria");
    expect(await screen.findByText("R$ 50,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 5,00")).toBeInTheDocument();
    expect(screen.getByText("18/11/2026 19:03")).toBeInTheDocument();
    const row = screen.getByText("Valor digitado errado").closest("tr");
    expect(row).toHaveTextContent("Venda");
    expect(row).toHaveTextContent("Edição");
    expect(row).toHaveTextContent("Valor bruto");
  });

  it("shows the owning area in the header and formats a day id as dd/mm/aaaa", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            entries: [
              {
                id: 8,
                at: "2026-11-17T23:40:00.000Z",
                entity: "day",
                entityId: "2026-11-17",
                action: "close",
                before: null,
                after: null,
                reason: null,
              },
            ],
            hasMore: false,
          }),
          { status: 200 },
        ),
    );
    renderAt("/configuracoes/auditoria");
    expect(await screen.findByText("17/11/2026")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Configurações");
  });

  it("FR-18: audit entries cannot be edited or deleted from the screen", async () => {
    renderAt("/configuracoes/auditoria");
    await screen.findByText("R$ 50,00");
    expect(screen.queryByRole("button", { name: /editar|excluir|apagar/i })).toBeNull();
  });

  it("FR-18: filters by type and date when the form is submitted", async () => {
    renderAt("/configuracoes/auditoria");
    await screen.findByText("R$ 50,00");

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-11-18" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "sale" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    await waitFor(() => {
      expect(requestedUrls()).toContainEqual(
        expect.stringMatching(/from=2026-11-01.*to=2026-11-18.*entity=sale/),
      );
    });
  });

  it("NFR-05: Enter on the Tipo select applies the filters", async () => {
    renderAt("/configuracoes/auditoria");
    await screen.findByText("R$ 50,00");

    const type = screen.getByLabelText("Tipo");
    fireEvent.change(type, { target: { value: "day" } });
    fireEvent.keyDown(type, { key: "Enter" });

    await waitFor(() => {
      expect(requestedUrls()).toContainEqual(expect.stringContaining("entity=day"));
    });
  });

  it("FR-18: shows a pt-BR message when the start date is after the end date", async () => {
    renderAt("/configuracoes/auditoria");
    await screen.findByText("R$ 50,00");

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-19" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-11-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    expect(
      await screen.findByText("A data inicial deve ser anterior ou igual à data final."),
    ).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ entries: [], hasMore: false }), { status: 200 }),
    );
    renderAt("/configuracoes/auditoria");
    expect(
      await screen.findByText("Nenhum registro de auditoria neste período."),
    ).toBeInTheDocument();
  });
});
