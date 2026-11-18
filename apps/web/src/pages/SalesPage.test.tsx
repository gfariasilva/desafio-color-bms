import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardFee, CardMachine, PaymentMethod, Sale, SaleCategory } from "@color-bms/core";
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

const tabs: SaleCategory[] = [
  { id: 1, name: "Acessórios", order: 1, active: true },
  { id: 2, name: "Recargas", order: 2, active: false },
  { id: 7, name: "Toner", order: 3, active: true },
];

const machines: CardMachine[] = [
  { id: 1, name: "PagSeguro", order: 1, active: true },
  { id: 2, name: "Mercado Pago", order: 2, active: true },
];

const methods: PaymentMethod[] = [
  {
    id: 1,
    name: "Dinheiro",
    order: 1,
    active: true,
    machineUsage: "not_applicable",
    allowsInstallments: false,
  },
  {
    id: 3,
    name: "Cartão de crédito",
    order: 2,
    active: true,
    machineUsage: "required",
    allowsInstallments: true,
  },
];

const fees: CardFee[] = [
  {
    id: 1,
    cardMachineId: 2,
    paymentMethodId: 3,
    installmentsFrom: 2,
    installmentsTo: 6,
    ratePpm: 37900,
    validFrom: "2026-01-01",
  },
];

function sale(overrides: Partial<Sale>): Sale {
  return {
    id: 1,
    date: TODAY,
    createdAt: "2026-11-18T13:05:00.000Z",
    type: "sale",
    saleCategoryId: 7,
    saleCategoryName: "Toner",
    paymentMethodId: 1,
    paymentMethodName: "Dinheiro",
    cardMachineId: null,
    cardMachineName: null,
    installments: null,
    grossCents: 2500,
    feeRatePpm: 0,
    feeCents: 0,
    netCents: 2500,
    note: null,
    ...overrides,
  };
}

let sales: Sale[];
let postResponse: () => Response;
const posts: unknown[] = [];
const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  posts.length = 0;
  sales = [];
  postResponse = () => json(sale({ id: 99 }), 201);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return postResponse();
    }
    if (url.startsWith("/api/today")) return json({ date: TODAY });
    if (url.startsWith("/api/sale-categories")) return json({ categories: tabs });
    if (url.startsWith("/api/payment-methods")) return json({ paymentMethods: methods });
    if (url.startsWith("/api/card-machines")) return json({ cardMachines: machines });
    if (url.startsWith("/api/card-fees")) return json({ fees });
    if (url.startsWith("/api/sales")) return json({ sales });
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openPage() {
  renderAt("/vendas");
  await screen.findByRole("radio", { name: /Toner/ });
  await waitFor(() => expect(screen.getByLabelText("Data")).toHaveValue(TODAY));
}

function value() {
  return screen.getByLabelText("Valor (R$)");
}

function submit() {
  fireEvent.submit(value().closest("form") as HTMLFormElement);
}

function pick(group: string, option: string) {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: new RegExp(option),
    }),
  );
}

describe("Vendas (FR-01, FR-02)", () => {
  it("FR-01: the date defaults to the server's today and focus starts on Valor", async () => {
    await openPage();
    expect(value()).toHaveFocus();
    expect(screen.getByLabelText("Data")).toHaveAttribute("max", TODAY);
  });

  it("FR-01: offers only active tabs, numbered for the keyboard", async () => {
    await openPage();
    const options = within(screen.getByRole("radiogroup", { name: "Aba" })).getAllByRole("radio");
    expect(options.map((option) => option.textContent)).toEqual(["1Acessórios", "2Toner"]);
  });

  it("FR-01: Maquininha and Parcelas are disabled for Dinheiro, enabled for Crédito", async () => {
    await openPage();
    pick("Forma de pagamento", "Dinheiro");
    for (const option of within(
      screen.getByRole("radiogroup", { name: "Maquininha" }),
    ).getAllByRole("radio")) {
      expect(option).toBeDisabled();
    }
    expect(screen.getByLabelText("Parcelas")).toBeDisabled();

    pick("Forma de pagamento", "Cartão de crédito");
    expect(screen.getByRole("radio", { name: /PagSeguro/ })).toBeEnabled();
    expect(screen.getByLabelText("Parcelas")).toBeEnabled();
    expect(screen.getByLabelText("Parcelas")).toHaveValue(1);
  });

  it("FR-01: saves a cash sale, keeps the date and returns focus to Valor", async () => {
    await openPage();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-10" } });
    fireEvent.change(value(), { target: { value: "25" } });
    pick("Aba", "Toner");
    pick("Forma de pagamento", "Dinheiro");
    submit();

    await screen.findByText(/Venda de R\$\s25,00 registrada/);
    expect(posts).toEqual([
      {
        date: "2026-11-10",
        grossCents: 2500,
        saleCategoryId: 7,
        paymentMethodId: 1,
        cardMachineId: null,
        installments: null,
        note: null,
      },
    ]);
    expect(value()).toHaveValue("");
    expect(value()).toHaveFocus();
    expect(screen.getByLabelText("Data")).toHaveValue("2026-11-10");
    expect(screen.getByRole("radio", { name: /Toner/ })).toHaveAttribute("aria-checked", "false");
  });

  it("FR-02: previews the fee in force and the net value before saving", async () => {
    await openPage();
    fireEvent.change(value(), { target: { value: "150,00" } });
    pick("Forma de pagamento", "Cartão de crédito");
    pick("Maquininha", "Mercado Pago");
    fireEvent.change(screen.getByLabelText("Parcelas"), { target: { value: "3" } });
    expect(screen.getByTestId("fee-preview")).toHaveTextContent(
      /Taxa 3,79%.*R\$\s5,69.*Líquido R\$\s144,31/,
    );
  });

  it("FR-01: explains an invalid value without calling the server", async () => {
    await openPage();
    fireEvent.change(value(), { target: { value: "abc" } });
    pick("Aba", "Toner");
    pick("Forma de pagamento", "Dinheiro");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o valor da venda, por exemplo 25,00.",
    );
    expect(posts).toEqual([]);
  });

  it("FR-01: asks for the tab and the payment method", async () => {
    await openPage();
    fireEvent.change(value(), { target: { value: "25" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha a aba.");
    pick("Aba", "Toner");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha a forma de pagamento.");
  });

  it("FR-01: a missing fee shows the server message with a link to the fee table", async () => {
    postResponse = () =>
      json(
        {
          error:
            "Cadastre a taxa de Mercado Pago / Cartão de crédito / 7x antes de registrar esta venda",
          code: "card_fee_missing",
        },
        409,
      );
    await openPage();
    fireEvent.change(value(), { target: { value: "150" } });
    pick("Aba", "Toner");
    pick("Forma de pagamento", "Cartão de crédito");
    pick("Maquininha", "Mercado Pago");
    fireEvent.change(screen.getByLabelText("Parcelas"), { target: { value: "7" } });
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Cadastre a taxa de Mercado Pago / Cartão de crédito / 7x antes de registrar esta venda",
    );
    expect(within(alert).getByRole("link", { name: "Abrir tabela de taxas" })).toHaveAttribute(
      "href",
      "/cadastros/taxas",
    );
    // The form is kept so the owner can try again after adding the fee.
    expect(value()).toHaveValue("150");
  });

  it("FR-01: lists the day's sales with the totals", async () => {
    sales = [
      sale({ id: 1 }),
      sale({
        id: 2,
        saleCategoryName: "Acessórios",
        paymentMethodName: "Cartão de crédito",
        cardMachineName: "Mercado Pago",
        installments: 3,
        grossCents: 15000,
        feeRatePpm: 37900,
        feeCents: 569,
        netCents: 14431,
      }),
    ];
    await openPage();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(/10:05.*Toner.*Dinheiro.*R\$\s25,00/);
    expect(rows[2]).toHaveTextContent(
      /Mercado Pago.*3x.*R\$\s150,00.*3,79%.*R\$\s5,69.*R\$\s144,31/,
    );
    expect(rows.at(-1)).toHaveTextContent(/Total do dia.*R\$\s175,00.*R\$\s5,69.*R\$\s169,31/);
  });

  it("FR-01: an empty day says how to start", async () => {
    await openPage();
    expect(
      await screen.findByText("Nenhuma venda neste dia. Registre a primeira com Enter."),
    ).toBeInTheDocument();
  });
});
