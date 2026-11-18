import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayExpensesResponse, Expense, ExpenseCategory } from "@color-bms/core";
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

const TODAY = "2026-11-18";

const categories: ExpenseCategory[] = [
  { id: 6, name: "Abastecimento moto", order: 1, active: true, group: "general" },
  { id: 7, name: "Diversos", order: 2, active: false, group: "general" },
  { id: 8, name: "Alimentação", order: 3, active: true, group: "general" },
  { id: 13, name: "Kalunga", order: 4, active: true, group: "suppliers" },
];

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 1,
    type: "general",
    status: "paid",
    paymentDate: TODAY,
    createdAt: "2026-11-18T13:05:00.000Z",
    expenseCategoryId: 6,
    expenseCategoryName: "Abastecimento moto",
    expenseCategoryOrder: 1,
    description: null,
    amountCents: 4500,
    paymentMeans: "cash",
    paidFromTill: true,
    ...overrides,
  };
}

let expenses: Expense[];
let dayLock: string | null;
let postResponse: () => Response;
const posts: unknown[] = [];
const patches: { url: string; body: unknown }[] = [];
const deletes: string[] = [];
const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  posts.length = 0;
  patches.length = 0;
  deletes.length = 0;
  expenses = [];
  dayLock = null;
  postResponse = () => json(expense({ id: 99 }), 201);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return postResponse();
    }
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return json(expense({ id: 1, amountCents: 5000 }));
    }
    if (init?.method === "DELETE") {
      deletes.push(url);
      return new Response(null, { status: 204 });
    }
    const day = /^\/api\/days\/([\d-]+)\/expenses/.exec(url);
    if (day) {
      const date = day[1]!;
      const ofDay = expenses.filter((item) => item.paymentDate === date);
      const response: DayExpensesResponse = {
        date,
        lock: dayLock,
        expenses: ofDay,
        totalCents: ofDay.reduce((total, item) => total + item.amountCents, 0),
        paidFromTillCents: ofDay
          .filter((item) => item.paidFromTill)
          .reduce((total, item) => total + item.amountCents, 0),
        monthGeneralTotalCents: 123456,
      };
      return json(response);
    }
    if (url.startsWith("/api/today")) return json({ date: TODAY });
    if (url.startsWith("/api/expense-categories")) return json({ categories });
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openPage() {
  renderAt("/despesas");
  await screen.findByRole("option", { name: "Abastecimento moto" });
  await waitFor(() => expect(screen.getByLabelText("Data")).toHaveValue(TODAY));
}

const value = () => screen.getByLabelText("Valor (R$)");
const category = () => screen.getByLabelText("Categoria");
const fromTill = () => screen.getByLabelText("Pago com dinheiro do caixa");

function submit() {
  fireEvent.submit(value().closest("form") as HTMLFormElement);
}

function pickMeans(name: string) {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Meio de pagamento" })).getByRole("radio", {
      name: new RegExp(name),
    }),
  );
}

describe("Despesas (FR-06)", () => {
  it("FR-06: the date defaults to the server's today and focus starts on Valor", async () => {
    await openPage();
    expect(value()).toHaveFocus();
    expect(screen.getByLabelText("Data")).toHaveAttribute("max", TODAY);
  });

  it("FR-06: offers only active categories, in their groups", async () => {
    await openPage();
    const groups = within(category()).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("label"))).toEqual([
      "Geral",
      "Fornecedores de materiais",
    ]);
    expect(within(category()).queryByRole("option", { name: "Diversos" })).toBeNull();
    expect(within(category()).getByRole("option", { name: "Kalunga" })).toBeInTheDocument();
  });

  it("A-14: the five payment means are numbered for the keyboard", async () => {
    await openPage();
    const options = within(
      screen.getByRole("radiogroup", { name: "Meio de pagamento" }),
    ).getAllByRole("radio");
    expect(options.map((option) => option.textContent)).toEqual([
      "1Dinheiro",
      "2PIX",
      "3Cartão",
      "4Boleto",
      "5Transferência/Débito em conta",
    ]);
  });

  it("FR-06: 'pago do caixa' is only for Dinheiro, and then yes by default", async () => {
    await openPage();
    expect(fromTill()).toBeDisabled();
    pickMeans("Dinheiro");
    expect(fromTill()).toBeEnabled();
    expect(fromTill()).toBeChecked();
    pickMeans("PIX");
    expect(fromTill()).toBeDisabled();
    expect(fromTill()).not.toBeChecked();
  });

  it("FR-06: saves R$ 45,00 in Abastecimento moto, cash from the till; keeps the date and returns focus to Valor", async () => {
    await openPage();
    fireEvent.change(value(), { target: { value: "45" } });
    fireEvent.change(category(), { target: { value: "6" } });
    pickMeans("Dinheiro");
    submit();

    await screen.findByText(/Despesa de R\$\s45,00 registrada/);
    expect(posts).toEqual([
      {
        paymentDate: TODAY,
        expenseCategoryId: 6,
        amountCents: 4500,
        paymentMeans: "cash",
        paidFromTill: true,
        description: null,
      },
    ]);
    expect(value()).toHaveValue("");
    expect(value()).toHaveFocus();
    expect(screen.getByLabelText("Data")).toHaveValue(TODAY);
  });

  it("FR-06: a PIX expense is sent as not paid from the till", async () => {
    postResponse = () =>
      json(expense({ id: 99, amountCents: 1200, paymentMeans: "pix", paidFromTill: false }), 201);
    await openPage();
    fireEvent.change(value(), { target: { value: "12,00" } });
    fireEvent.change(category(), { target: { value: "13" } });
    pickMeans("PIX");
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "papel" } });
    submit();
    await screen.findByText(/Despesa de R\$\s12,00 registrada/);
    expect(posts[0]).toMatchObject({
      paymentMeans: "pix",
      paidFromTill: false,
      description: "papel",
    });
  });

  it("FR-06: explains an invalid value and a missing category without calling the server", async () => {
    await openPage();
    fireEvent.change(value(), { target: { value: "abc" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o valor da despesa, por exemplo 45,00.",
    );
    fireEvent.change(value(), { target: { value: "0" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe um valor maior que zero.");
    fireEvent.change(value(), { target: { value: "45" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha a categoria.");
    fireEvent.change(category(), { target: { value: "6" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha o meio de pagamento.");
    expect(posts).toEqual([]);
  });

  it("FR-06: shows the server's message (e.g. a closed day)", async () => {
    postResponse = () =>
      json(
        {
          error:
            "O dia 18/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
          code: "day_closed",
        },
        409,
      );
    await openPage();
    fireEvent.change(value(), { target: { value: "45" } });
    fireEvent.change(category(), { target: { value: "6" } });
    pickMeans("Dinheiro");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("O dia 18/11/2026 está fechado.");
  });

  it("FR-06: lists the day's expenses with the totals and the month's general expenses (RN-08)", async () => {
    expenses = [
      expense({ id: 1, amountCents: 4500 }),
      expense({
        id: 2,
        amountCents: 1200,
        paymentMeans: "pix",
        paidFromTill: false,
        expenseCategoryId: 13,
        expenseCategoryName: "Kalunga",
        description: "papel A4",
      }),
    ];
    await openPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("papel A4")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Total do dia/ })).toHaveTextContent(
      /R\$\s57,00/,
    );
    expect(within(table).getByRole("row", { name: /Pago do caixa/ })).toHaveTextContent(
      /R\$\s45,00/,
    );
    expect(screen.getByText(/Despesas gerais do mês/)).toHaveTextContent(/R\$\s1\.234,56/);
  });

  it("FR-06: an empty day says how to start", async () => {
    await openPage();
    expect(
      await screen.findByText("Nenhuma despesa neste dia. Registre a primeira com Enter."),
    ).toBeInTheDocument();
  });

  it("FR-06 (as FR-03): Editar loads the expense into the form and saves the change", async () => {
    expenses = [expense({ id: 1, description: "posto" })];
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: /Editar despesa/ }));
    expect(screen.getByRole("form", { name: "Editar despesa" })).toBeInTheDocument();
    expect(value()).toHaveValue("45,00");
    expect(category()).toHaveValue("6");
    expect(fromTill()).toBeChecked();
    fireEvent.change(value(), { target: { value: "50" } });
    submit();
    await screen.findByText("Despesa alterada.");
    expect(patches).toEqual([
      {
        url: "/api/expenses/1",
        body: {
          paymentDate: TODAY,
          expenseCategoryId: 6,
          amountCents: 5000,
          paymentMeans: "cash",
          paidFromTill: true,
          description: "posto",
        },
      },
    ]);
    expect(screen.getByRole("form", { name: "Nova despesa" })).toBeInTheDocument();
  });

  it("FR-06: Esc cancels the edit without saving", async () => {
    expenses = [expense({ id: 1 })];
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: /Editar despesa/ }));
    fireEvent.keyDown(value(), { key: "Escape" });
    expect(screen.getByRole("form", { name: "Nova despesa" })).toBeInTheDocument();
    expect(value()).toHaveValue("");
    expect(patches).toEqual([]);
  });

  it("FR-06: an inactive category of the edited expense is offered while editing", async () => {
    expenses = [expense({ id: 1, expenseCategoryId: 7, expenseCategoryName: "Diversos" })];
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: /Editar despesa/ }));
    expect(within(category()).getByRole("option", { name: "Diversos" })).toBeInTheDocument();
    expect(category()).toHaveValue("7");
  });

  it("FR-06 (as FR-03): Excluir asks for confirmation before deleting", async () => {
    expenses = [expense({ id: 1 })];
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await openPage();
    const button = await screen.findByRole("button", { name: /Excluir despesa/ });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/Excluir a despesa de R\$\s45,00 \(Abastecimento moto, Dinheiro\)\?/),
    );
    expect(deletes).toEqual([]);
    fireEvent.click(button);
    await screen.findByText("Despesa excluída.");
    expect(deletes).toEqual(["/api/expenses/1"]);
  });

  it("RN-14: on a closed day, editing and deleting are blocked with the reopen hint", async () => {
    expenses = [expense({ id: 1 })];
    dayLock = "O dia 18/11/2026 está fechado. Reabra o dia para alterar ou excluir esta despesa.";
    const confirm = vi.spyOn(window, "confirm");
    await openPage();
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Editar despesa/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(dayLock);
    expect(screen.getByRole("form", { name: "Nova despesa" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Excluir despesa/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });
});
