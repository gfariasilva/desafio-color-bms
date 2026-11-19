import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContaCandidatesResponse,
  FixedExpense,
  MonthFixedExpensesResponse,
} from "@color-bms/core";
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
let candidates: ContaCandidatesResponse;
const posts: unknown[] = [];
const postUrls: string[] = [];
const requestedUrls: string[] = [];
let postResult: { status: number; body: unknown };

beforeEach(() => {
  posts.length = 0;
  postUrls.length = 0;
  requestedUrls.length = 0;
  candidates = { withdrawals: [], pendingExpenses: [] };
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
    paidTotalCents: 0,
  };
  postResult = { status: 201, body: entry(9, "Seguro carro", { oneOff: true }) };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (init?.method === "POST") {
        postUrls.push(url);
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(postResult.body), { status: postResult.status });
      }
      if (url === "/api/today") {
        return new Response(JSON.stringify({ date: "2026-11-18" }), { status: 200 });
      }
      if (url === "/api/conta-conversions") {
        return new Response(JSON.stringify(candidates), { status: 200 });
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

describe("Pagar ou dispensar (FR-12, FR-13)", () => {
  it("FR-12: pays a bill from its row: expected amount and today pre-filled, means by digit, Enter pays", async () => {
    postResult = {
      status: 200,
      body: entry(1, "Luz", {
        status: "paid",
        amountCents: 18743,
        paymentDate: "2026-11-10",
        paymentMeans: "pix",
      }),
    };
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Luz" }));

    const form = await screen.findByRole("form", { name: "Pagar Luz" });
    const value = within(form).getByLabelText("Valor pago (R$)");
    expect(value).toHaveFocus();
    expect(value).toHaveValue("200,00");
    expect(within(form).getByLabelText("Data do pagamento")).toHaveValue("2026-11-18");
    // "Pago com dinheiro do caixa" applies only to Dinheiro.
    expect(within(form).getByLabelText("Pago com dinheiro do caixa")).toBeDisabled();

    fireEvent.change(value, { target: { value: "187,43" } });
    fireEvent.change(within(form).getByLabelText("Data do pagamento"), {
      target: { value: "2026-11-10" },
    });
    fireEvent.click(within(form).getByRole("radio", { name: /PIX/ }));
    fireEvent.submit(form);

    await screen.findByText("Luz paga: R$ 187,43 em 10/11/2026.");
    expect(postUrls).toEqual(["/api/fixed-expenses/1/pay"]);
    expect(posts).toEqual([
      { amountCents: 18743, paymentDate: "2026-11-10", paymentMeans: "pix", paidFromTill: false },
    ]);
    expect(screen.queryByRole("form", { name: "Pagar Luz" })).not.toBeInTheDocument();
  });

  it("FR-12 / RN-07: Dinheiro is paid from the till by default", async () => {
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Luz" }));
    const form = await screen.findByRole("form", { name: "Pagar Luz" });
    fireEvent.click(within(form).getByRole("radio", { name: /Dinheiro/ }));
    expect(within(form).getByLabelText("Pago com dinheiro do caixa")).toBeChecked();
    expect(form).toHaveTextContent("reduz o dinheiro esperado");
    fireEvent.submit(form);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ paymentMeans: "cash", paidFromTill: true });
  });

  it("FR-12: validates before calling the server; Esc cancels and returns focus to Pagar", async () => {
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Luz" }));
    const form = await screen.findByRole("form", { name: "Pagar Luz" });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Escolha o meio de pagamento.",
    );

    fireEvent.click(within(form).getByRole("radio", { name: /PIX/ }));
    fireEvent.change(within(form).getByLabelText("Data do pagamento"), {
      target: { value: "2026-11-19" },
    });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Não é possível registrar lançamentos com data futura.",
    );
    expect(posts).toEqual([]);

    fireEvent.keyDown(within(form).getByLabelText("Valor pago (R$)"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Pagar Luz" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Pagar Luz" })).toHaveFocus();
  });

  it("FR-12 / A-16: shows the server's message for a closed day", async () => {
    postResult = {
      status: 409,
      body: {
        error: "O dia 10/11/2026 está fechado. Reabra o dia para registrar pagamentos nessa data.",
        code: "day_closed",
      },
    };
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Luz" }));
    const form = await screen.findByRole("form", { name: "Pagar Luz" });
    fireEvent.click(within(form).getByRole("radio", { name: /PIX/ }));
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "O dia 10/11/2026 está fechado.",
    );
  });

  it("FR-12: a paid bill shows the payment and can be undone; a dismissed one reactivated", async () => {
    response = {
      ...response,
      expenses: [
        entry(1, "Luz", {
          status: "paid",
          amountCents: 12000,
          paymentDate: "2026-11-18",
          paymentMeans: "cash",
          paidFromTill: true,
        }),
        entry(2, "Empréstimos", {
          status: "paid",
          amountCents: 50000,
          paymentDate: "2026-11-10",
          paymentMeans: "boleto",
          installmentNumber: 3,
          installmentsTotal: 12,
        }),
        entry(3, "TFE", { group: "government_fees", status: "dismissed" }),
      ],
      paidTotalCents: 62000,
    };
    await openPage();
    const luz = screen.getByRole("row", { name: /Luz/ });
    expect(luz).toHaveTextContent("R$ 120,00 · 18/11/2026 · Dinheiro do caixa");
    expect(screen.getByRole("row", { name: /Empréstimos/ })).toHaveTextContent("parcela 3 de 12");
    expect(screen.getByText(/Pago no mês/)).toHaveTextContent("R$ 620,00");
    expect(within(luz).queryByRole("button", { name: "Pagar Luz" })).not.toBeInTheDocument();

    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    postResult = { status: 200, body: entry(1, "Luz") };
    fireEvent.click(within(luz).getByRole("button", { name: "Desfazer o pagamento de Luz" }));
    await screen.findByText("Pagamento de Luz desfeito.");
    expect(postUrls).toEqual(["/api/fixed-expenses/1/undo"]);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("A conta volta a pendente"));

    postResult = { status: 200, body: entry(3, "TFE", { group: "government_fees" }) };
    fireEvent.click(screen.getByRole("button", { name: "Reativar TFE" }));
    await screen.findByText("TFE reativada.");
    expect(postUrls).toEqual(["/api/fixed-expenses/1/undo", "/api/fixed-expenses/3/undo"]);
  });

  it("FR-12: dismisses a bill after confirming; nothing happens if the owner says no", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Dispensar DAS" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("sai dos totais e dos alertas"));
    expect(posts).toEqual([]);

    confirm.mockReturnValue(true);
    postResult = { status: 200, body: entry(3, "DAS", { status: "dismissed" }) };
    fireEvent.click(screen.getByRole("button", { name: "Dispensar DAS" }));
    await screen.findByText("DAS dispensada.");
    expect(postUrls).toEqual(["/api/fixed-expenses/3/dismiss"]);
  });
});

describe("Conversão das sangrias CONTA: (#13)", () => {
  it("#13: hidden when there is nothing to convert", async () => {
    await openPage();
    expect(screen.queryByRole("heading", { name: /Sangrias “CONTA:”/ })).not.toBeInTheDocument();
  });

  it("#13: converts a sangria into a new one-off bill or into a pending bill the owner picks", async () => {
    candidates = {
      withdrawals: [
        {
          id: 7,
          date: "2026-11-10",
          amountCents: 18743,
          note: "CONTA: Luz outubro",
          suggestedName: "Luz outubro",
          dayClosed: true,
        },
      ],
      pendingExpenses: [entry(1, "Luz", { dueDate: "2026-11-10" })],
    };
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    postResult = {
      status: 200,
      body: entry(1, "Luz", {
        status: "paid",
        amountCents: 18743,
        paymentDate: "2026-11-10",
        paymentMeans: "cash",
        paidFromTill: true,
      }),
    };
    await openPage();
    const panel = await screen.findByRole("table", { name: /Sangrias “CONTA:”/ });
    const select = within(panel).getByLabelText("Converter a sangria de 10/11/2026 em");
    // Starts on a new one-off bill named after the note.
    expect(select).toHaveDisplayValue("Nova conta avulsa: Luz outubro");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Converter" }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("será reaberto e fechado de novo"),
    );
    await screen.findByText(/Sangria convertida: Luz paga em 10\/11\/2026/);
    expect(postUrls).toEqual(["/api/conta-conversions/7"]);
    expect(posts).toEqual([{ target: "existing", fixedExpenseId: 1 }]);
  });
});
