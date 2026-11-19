import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedExpense, MonthFixedExpensesResponse } from "@color-bms/core";
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

function entry(id: number, label: string, changes: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id,
    referenceMonth: "2026-11",
    label,
    group: "general",
    fixedExpenseTemplateId: id,
    oneOff: false,
    dueDate: null,
    expectedAmountCents: null,
    status: "pending",
    amountCents: null,
    paymentDate: null,
    paymentMeans: null,
    paidFromTill: false,
    installmentNumber: null,
    installmentsTotal: null,
    createdAt: "2026-11-01T03:00:00.000Z",
    ...changes,
  };
}

let response: MonthFixedExpensesResponse;
const posts: unknown[] = [];
const requestedUrls: string[] = [];
let postResult: { status: number; body: unknown };

beforeEach(() => {
  posts.length = 0;
  requestedUrls.length = 0;
  response = {
    month: "2026-11",
    currentMonth: "2026-11",
    generated: true,
    lock: null,
    expenses: [
      entry(1, "Luz", { dueDate: "2026-11-10", expectedAmountCents: 20000 }),
      entry(2, "Empréstimos", { installmentNumber: 3, installmentsTotal: 12 }),
      entry(3, "DAS", { group: "government_fees", dueDate: "2026-11-20" }),
      entry(4, "IPTU", {
        group: "government_fees",
        fixedExpenseTemplateId: null,
        oneOff: true,
        dueDate: "2026-11-25",
        expectedAmountCents: 15000,
      }),
    ],
    expectedTotalCents: 35000,
  };
  postResult = { status: 201, body: entry(9, "Seguro carro", { oneOff: true }) };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(postResult.body), { status: postResult.status });
      }
      if (url.startsWith("/api/fixed-expenses")) {
        const month = new URL(url, "http://x").searchParams.get("month") ?? "2026-11";
        return new Response(JSON.stringify({ ...response, month }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPage(path = "/despesas-fixas/mes") {
  renderAt(path);
  return screen.findByRole("heading", { name: /Contas de novembro de 2026/ });
}

describe("Contas do mês (FR-11)", () => {
  it("FR-11: lists the month's bills by group, with due date, expected amount and status", async () => {
    await openPage();
    const general = screen.getByRole("table", { name: "Gerais" });
    const luz = within(general).getByRole("row", { name: /Luz/ });
    expect(luz).toHaveTextContent("10/11/2026");
    expect(luz).toHaveTextContent("R$ 200,00");
    expect(luz).toHaveTextContent("Pendente");

    const fees = screen.getByRole("table", { name: "Taxas governo" });
    expect(within(fees).getByRole("row", { name: /IPTU/ })).toHaveTextContent("Avulsa");
    expect(screen.getByText(/Total previsto/)).toHaveTextContent("R$ 350,00");
  });

  it("FR-11 / Q-05: a bill without due day says so and links to the templates", async () => {
    await openPage();
    const row = screen.getByRole("row", { name: /Empréstimos/ });
    expect(row).toHaveTextContent("Sem vencimento");
    expect(row).toHaveTextContent("parcela 3 de 12");
    expect(
      within(row).getByRole("link", { name: "Preencher o vencimento de Empréstimos no modelo" }),
    ).toHaveAttribute("href", "/despesas-fixas/modelos");
  });

  it("FR-11: navigates to the previous month, never past the current one", async () => {
    await openPage();
    expect(screen.getByRole("button", { name: "Próximo mês" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await screen.findByRole("heading", { name: /Contas de outubro de 2026/ });
    expect(requestedUrls).toContain("/api/fixed-expenses?month=2026-10");
    // The buttons wait for the month's data, then the next month is allowed again.
    await waitFor(() => expect(screen.getByRole("button", { name: "Próximo mês" })).toBeEnabled());
  });

  it("FR-11: says when a month was never generated", async () => {
    response = { ...response, generated: false, expenses: [], expectedTotalCents: 0 };
    await openPage();
    expect(screen.getAllByText(/não foram geradas/)[0]).toBeInTheDocument();
  });

  it("FR-11: adds a one-off bill with Enter and returns focus to Conta", async () => {
    await openPage();
    const name = screen.getByLabelText("Conta");
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "Seguro carro" } });
    fireEvent.change(screen.getByLabelText("Grupo"), { target: { value: "general" } });
    fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: "2026-11-28" } });
    fireEvent.change(screen.getByLabelText("Valor previsto (R$)"), {
      target: { value: "1.250,90" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Nova conta avulsa" }));

    await screen.findByText("Conta avulsa Seguro carro adicionada.");
    expect(posts).toEqual([
      {
        referenceMonth: "2026-11",
        description: "Seguro carro",
        group: "general",
        dueDate: "2026-11-28",
        expectedAmountCents: 125090,
      },
    ]);
    await waitFor(() => expect(screen.getByLabelText("Conta")).toHaveFocus());
    expect(screen.getByLabelText("Conta")).toHaveValue("");
  });

  it("FR-11: validates with the core messages before calling the server", async () => {
    await openPage();
    fireEvent.submit(screen.getByRole("form", { name: "Nova conta avulsa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o nome da conta.");

    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "IPVA" } });
    fireEvent.submit(screen.getByRole("form", { name: "Nova conta avulsa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Data de vencimento inválida.");

    fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: "2026-11-28" } });
    fireEvent.change(screen.getByLabelText("Valor previsto (R$)"), { target: { value: "abc" } });
    fireEvent.submit(screen.getByRole("form", { name: "Nova conta avulsa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/valor previsto/);
    expect(posts).toEqual([]);
  });

  it("RN-14: shows the server's message and disables the form on a closed month", async () => {
    response = {
      ...response,
      lock: "O mês 11/2026 está fechado. Reabra o mês para adicionar contas nele.",
    };
    await openPage();
    expect(screen.getByText(/está fechado/)).toBeInTheDocument();
    expect(screen.getByLabelText("Conta")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adicionar" })).toBeDisabled();
  });

  it("shows a server error in the alert line", async () => {
    postResult = { status: 409, body: { error: "O mês 11/2026 está fechado." } };
    await openPage();
    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "IPVA" } });
    fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: "2026-11-28" } });
    fireEvent.submit(screen.getByRole("form", { name: "Nova conta avulsa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O mês 11/2026 está fechado.");
  });

  it("the hub links to Contas do mês", async () => {
    renderAt("/despesas-fixas");
    expect(await screen.findByRole("link", { name: /Contas do mês/ })).toHaveAttribute(
      "href",
      "/despesas-fixas/mes",
    );
  });
});
