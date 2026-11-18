import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  summarizeDaySales,
  type CardFee,
  type CardMachine,
  type PaymentMethod,
  type Sale,
  type SaleCategory,
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
    originalSaleId: null,
    originalSaleDate: null,
    reason: null,
    refundedCents: 0,
    ...overrides,
  };
}

let sales: Sale[];
let dayLock: string | null;
let postResponse: () => Response;
let patchResponse: () => Response;
let refundResponse: () => Response;
const posts: unknown[] = [];
const refundPosts: { url: string; body: unknown }[] = [];
const patches: { url: string; body: unknown }[] = [];
const deletes: string[] = [];
const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  posts.length = 0;
  refundPosts.length = 0;
  refundResponse = () =>
    json(
      sale({
        id: 50,
        type: "refund",
        grossCents: -8000,
        netCents: -8000,
        originalSaleId: 5,
        originalSaleDate: "2026-11-10",
        reason: "produto com defeito",
      }),
      201,
    );
  patches.length = 0;
  deletes.length = 0;
  sales = [];
  dayLock = null;
  postResponse = () => json(sale({ id: 99 }), 201);
  patchResponse = () => json(sale({ id: 1, grossCents: 3000, netCents: 3000 }));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/refunds")) {
      refundPosts.push({ url, body: JSON.parse(String(init.body)) });
      return refundResponse();
    }
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return postResponse();
    }
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return patchResponse();
    }
    if (init?.method === "DELETE") {
      deletes.push(url);
      return new Response(null, { status: 204 });
    }
    // FR-05: the server groups the day with the same core function.
    const day = /^\/api\/days\/([\d-]+)\/sales/.exec(url);
    if (day) {
      const date = day[1]!;
      const ofDay = sales.filter((item) => item.date === date);
      return json({ date, lock: dayLock, ...summarizeDaySales({ tabs, methods, sales: ofDay }) });
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

  it("FR-01: an amount above the maximum gets the maximum-value message", async () => {
    await openPage();
    fireEvent.change(value(), { target: { value: "1.500.000,00" } });
    pick("Aba", "Toner");
    pick("Forma de pagamento", "Dinheiro");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /O valor máximo de uma venda é R\$\s999\.999,99\./,
    );
    expect(posts).toEqual([]);
  });

  it("RN-15: explains when the server's date cannot be loaded", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input).startsWith("/api/today") ? json({ error: "boom" }, 500) : original(input, init),
    );
    renderAt("/vendas");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível obter a data de hoje do servidor. Recarregue a página.",
    );
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

  it("FR-01: an empty day says how to start", async () => {
    await openPage();
    expect(
      await screen.findByText("Nenhuma venda neste dia. Registre a primeira com Enter."),
    ).toBeInTheDocument();
  });
});

describe("Vendas: the day per tab (FR-05)", () => {
  const credit = sale({
    id: 2,
    saleCategoryId: 1,
    saleCategoryName: "Acessórios",
    paymentMethodId: 3,
    paymentMethodName: "Cartão de crédito",
    cardMachineId: 2,
    cardMachineName: "Mercado Pago",
    installments: 3,
    grossCents: 15000,
    feeRatePpm: 37900,
    feeCents: 569,
    netCents: 14431,
  });

  it("FR-05: each tab shows its sales, subtotals per method and total; the day total last", async () => {
    sales = [sale({ id: 1 }), credit, sale({ id: 3, grossCents: 1000, netCents: 1000 })];
    await openPage();
    const toner = await screen.findByRole("region", { name: /Toner/ });
    const rows = within(toner).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(/10:05.*Dinheiro.*R\$\s25,00/);
    expect(within(toner).getByText("Subtotal Dinheiro").closest("tr")).toHaveTextContent(
      /R\$\s35,00.*R\$\s0,00.*R\$\s35,00/,
    );
    expect(within(toner).getByText("Total da aba").closest("tr")).toHaveTextContent(/R\$\s35,00/);

    const accessories = screen.getByRole("region", { name: /Acessórios/ });
    expect(within(accessories).getAllByRole("row")[1]).toHaveTextContent(
      /Mercado Pago.*3x.*R\$\s150,00.*3,79%.*R\$\s5,69.*R\$\s144,31/,
    );
    expect(screen.getByTestId("day-total")).toHaveTextContent(
      /Total do dia.*R\$\s185,00.*R\$\s5,69.*R\$\s179,31/,
    );
  });

  it("FR-05: a tab without sales shows R$ 0,00 and starts collapsed; a tab can be collapsed", async () => {
    sales = [sale({ id: 1 })];
    await openPage();
    const emptyTab = await screen.findByRole("button", { name: /Acessórios/ });
    expect(emptyTab).toHaveAttribute("aria-expanded", "false");
    expect(emptyTab).toHaveTextContent(/R\$\s0,00/);
    // Inactive tabs without sales are not listed.
    expect(screen.queryByRole("button", { name: /Recargas/ })).not.toBeInTheDocument();

    const toner = screen.getByRole("button", { name: /Toner/ });
    expect(toner).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toner);
    expect(toner).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Editar venda/ })).not.toBeInTheDocument();
    fireEvent.click(emptyTab);
    expect(await screen.findByText("Nenhuma venda nesta aba.")).toBeInTheDocument();
  });

  it("FR-03: Editar loads the sale into the form and saves the change", async () => {
    sales = [sale({ id: 1, note: "balcão" })];
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: /Editar venda/ }));

    expect(screen.getByRole("form", { name: "Editar venda" })).toBeInTheDocument();
    expect(value()).toHaveValue("25,00");
    expect(value()).toHaveFocus();
    expect(screen.getByRole("radio", { name: /Toner/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Observação")).toHaveValue("balcão");

    fireEvent.change(value(), { target: { value: "30" } });
    submit();
    await screen.findByText("Venda alterada.");
    expect(patches).toEqual([
      {
        url: "/api/sales/1",
        body: {
          date: TODAY,
          grossCents: 3000,
          saleCategoryId: 7,
          paymentMethodId: 1,
          cardMachineId: null,
          installments: null,
          note: "balcão",
        },
      },
    ]);
    // Back to a new sale, keeping the date, focus on Valor.
    expect(screen.getByRole("form", { name: "Nova venda" })).toBeInTheDocument();
    expect(value()).toHaveValue("");
    expect(value()).toHaveFocus();
  });

  it("FR-03: Esc cancels the edit without saving", async () => {
    sales = [sale({ id: 1 })];
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: /Editar venda/ }));
    fireEvent.keyDown(value(), { key: "Escape" });
    expect(screen.getByRole("form", { name: "Nova venda" })).toBeInTheDocument();
    expect(value()).toHaveValue("");
    expect(patches).toEqual([]);
  });

  it("FR-03: a new sale being typed comes back after the edit is cancelled or saved", async () => {
    sales = [sale({ id: 1 })];
    await openPage();
    fireEvent.change(value(), { target: { value: "150" } });
    pick("Aba", "Acessórios");
    const edit = await screen.findByRole("button", { name: /Editar venda/ });

    fireEvent.click(edit);
    expect(value()).toHaveValue("25,00");
    fireEvent.keyDown(value(), { key: "Escape" });
    expect(value()).toHaveValue("150");
    expect(screen.getByRole("radio", { name: /Acessórios/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(edit);
    submit();
    await screen.findByText("Venda alterada.");
    expect(value()).toHaveValue("150");
  });

  it("FR-05: a tab collapsed on one day starts open on another day with sales", async () => {
    sales = [sale({ id: 1 }), sale({ id: 2, date: "2026-11-17" })];
    await openPage();
    const toner = () => screen.getByRole("button", { name: /Toner/ });
    await waitFor(() => expect(toner()).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(toner());
    expect(toner()).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-17" } });
    await screen.findByText("Vendas de 17/11/2026");
    await waitFor(() => expect(toner()).toHaveAttribute("aria-expanded", "true"));
  });

  it("FR-03: an inactive tab of the edited sale is offered while editing", async () => {
    sales = [sale({ id: 1, saleCategoryId: 2, saleCategoryName: "Recargas" })];
    await openPage();
    expect(screen.queryByRole("radio", { name: /Recargas/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Editar venda/ }));
    expect(screen.getByRole("radio", { name: /Recargas/ })).toHaveAttribute("aria-checked", "true");
  });

  it("FR-03: Excluir asks for confirmation before deleting", async () => {
    sales = [sale({ id: 1 })];
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await openPage();
    const button = await screen.findByRole("button", { name: /Excluir venda/ });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/Excluir a venda de R\$\s25,00 \(Toner, Dinheiro\)\?/),
    );
    expect(deletes).toEqual([]);
    fireEvent.click(button);
    await screen.findByText("Venda excluída.");
    expect(deletes).toEqual(["/api/sales/1"]);
  });

  it("FR-03: on a closed day, editing and deleting are blocked with the reopen/refund hint", async () => {
    sales = [sale({ id: 1, date: TODAY })];
    dayLock =
      "O dia 18/11/2026 está fechado. Reabra o dia para alterar esta venda ou registre um estorno.";
    const confirm = vi.spyOn(window, "confirm");
    await openPage();
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Editar venda/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(dayLock);
    expect(screen.getByRole("form", { name: "Nova venda" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Excluir venda/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });
});

describe("Estornos (FR-04)", () => {
  const OLD_DAY = "2026-11-10";
  const oldSale = () =>
    sale({
      id: 5,
      date: OLD_DAY,
      paymentMethodId: 3,
      paymentMethodName: "Cartão de crédito",
      cardMachineId: 1,
      cardMachineName: "PagSeguro",
      installments: 1,
      grossCents: 8000,
      feeRatePpm: 19900,
      feeCents: 159,
      netCents: 7841,
    });

  async function openOldDay() {
    await openPage();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: OLD_DAY } });
    await screen.findByText("Vendas de 10/11/2026");
  }

  it("FR-04: Estornar shows only on sales from earlier days", async () => {
    sales = [sale({ id: 1 }), oldSale()];
    await openPage();
    await screen.findByRole("button", { name: /Editar venda/ });
    expect(screen.queryByRole("button", { name: /Estornar venda/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: OLD_DAY } });
    expect(await screen.findByRole("button", { name: /Estornar venda/ })).toBeInTheDocument();
  });

  it("FR-04: the refund form starts with what is left and previews the negative fee (RN-04)", async () => {
    sales = [{ ...oldSale(), refundedCents: 5000 }];
    await openOldDay();
    fireEvent.click(await screen.findByRole("button", { name: /Estornar venda/ }));
    const form = screen.getByRole("form", { name: "Estornar venda" });
    const refundValue = within(form).getByLabelText("Valor do estorno (R$)");
    expect(refundValue).toHaveValue("30,00");
    expect(refundValue).toHaveFocus();
    expect(screen.getByTestId("refund-preview")).toHaveTextContent(
      /Bruto -R\$\s30,00 · Taxa 1,99% · -R\$\s0,60 · Líquido -R\$\s29,40/,
    );
    // A refunded sale is no longer edited or deleted.
    expect(screen.queryByRole("button", { name: /Editar venda/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Estornado R\$\s50,00/)).toBeInTheDocument();
  });

  it("FR-04: the reason is required and the sum cannot pass the sale", async () => {
    sales = [{ ...oldSale(), refundedCents: 5000 }];
    await openOldDay();
    fireEvent.click(await screen.findByRole("button", { name: /Estornar venda/ }));
    const form = screen.getByRole("form", { name: "Estornar venda" });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Informe o motivo do estorno.",
    );
    fireEvent.change(within(form).getByLabelText("Motivo"), { target: { value: "defeito" } });
    fireEvent.change(within(form).getByLabelText("Valor do estorno (R$)"), {
      target: { value: "40" },
    });
    fireEvent.submit(form);
    expect(within(form).getByRole("alert")).toHaveTextContent(
      /O estorno passa do valor da venda: restam R\$\s30,00 para estornar\./,
    );
    expect(refundPosts).toEqual([]);
  });

  it("FR-04: Enter registers the refund, then focus returns to Valor", async () => {
    sales = [oldSale()];
    await openOldDay();
    fireEvent.click(await screen.findByRole("button", { name: /Estornar venda/ }));
    const form = screen.getByRole("form", { name: "Estornar venda" });
    fireEvent.change(within(form).getByLabelText("Motivo"), {
      target: { value: "produto com defeito" },
    });
    fireEvent.submit(form);
    await screen.findByText(/Estorno de R\$\s80,00 registrado em 18\/11\/2026\./);
    expect(refundPosts).toEqual([
      { url: "/api/sales/5/refunds", body: { refundCents: 8000, reason: "produto com defeito" } },
    ]);
    expect(screen.queryByRole("form", { name: "Estornar venda" })).not.toBeInTheDocument();
    expect(value()).toHaveFocus();
  });

  it("FR-04: shows the server's message (e.g. today closed) and Esc cancels", async () => {
    sales = [oldSale()];
    const message =
      "O dia 18/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.";
    refundResponse = () => json({ error: message, code: "day_closed" }, 409);
    await openOldDay();
    fireEvent.click(await screen.findByRole("button", { name: /Estornar venda/ }));
    const form = screen.getByRole("form", { name: "Estornar venda" });
    fireEvent.change(within(form).getByLabelText("Motivo"), { target: { value: "defeito" } });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(message);
    fireEvent.keyDown(within(form).getByLabelText("Motivo"), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Estornar venda" })).not.toBeInTheDocument();
    expect(value()).toHaveFocus();
  });

  it("FR-04: refund rows show the badge, the original date and the reason; only Excluir", async () => {
    sales = [
      sale({
        id: 50,
        type: "refund",
        grossCents: -8000,
        netCents: -8000,
        originalSaleId: 5,
        originalSaleDate: OLD_DAY,
        reason: "produto com defeito",
      }),
    ];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await openPage();
    expect(await screen.findByText("Estorno")).toBeInTheDocument();
    expect(screen.getByText("da venda de 10/11/2026")).toBeInTheDocument();
    expect(screen.getByText("· produto com defeito")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Estornar/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Excluir estorno/ }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/^Excluir o estorno de R\$\s80,00 \(Toner, Dinheiro\)\?/),
    );
    await screen.findByText("Estorno excluído.");
    expect(deletes).toEqual(["/api/sales/50"]);
  });
});
