import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  todayCivilDate,
  type CardFee,
  type CardMachine,
  type PaymentMethod,
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

const machines: CardMachine[] = [
  { id: 1, name: "PagSeguro", order: 1, active: true },
  { id: 2, name: "Mercado Pago", order: 2, active: true },
  { id: 3, name: "Cielo antiga", order: 3, active: false },
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
    id: 2,
    name: "Cartão de débito",
    order: 2,
    active: true,
    machineUsage: "required",
    allowsInstallments: false,
  },
  {
    id: 3,
    name: "Cartão de crédito",
    order: 3,
    active: true,
    machineUsage: "required",
    allowsInstallments: true,
  },
  {
    id: 4,
    name: "PIX/Depósito",
    order: 4,
    active: true,
    machineUsage: "optional",
    allowsInstallments: false,
  },
];

let fees: CardFee[] = [];

interface Call {
  method: string;
  url: string;
  body: unknown;
}
const calls: Call[] = [];
let writeResponse: () => Response;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  calls.length = 0;
  // In the server's order (GET /api/card-fees): machine, method, range, newest first.
  fees = [
    {
      id: 13,
      cardMachineId: 1,
      paymentMethodId: 2,
      installmentsFrom: 1,
      installmentsTo: 1,
      ratePpm: 14900,
      validFrom: "2020-01-01",
    },
    {
      id: 12,
      cardMachineId: 1,
      paymentMethodId: 2,
      installmentsFrom: 1,
      installmentsTo: 1,
      ratePpm: 19900,
      validFrom: "2019-01-01",
    },
    {
      id: 11,
      cardMachineId: 1,
      paymentMethodId: 3,
      installmentsFrom: 2,
      installmentsTo: 6,
      ratePpm: 45900,
      validFrom: "2099-12-01",
    },
    {
      id: 10,
      cardMachineId: 1,
      paymentMethodId: 3,
      installmentsFrom: 2,
      installmentsTo: 6,
      ratePpm: 49900,
      validFrom: "2020-01-01",
    },
  ];
  writeResponse = () => new Response(JSON.stringify(fees[3]), { status: 201 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") {
      if (url.startsWith("/api/card-machines")) {
        return new Response(JSON.stringify({ cardMachines: machines }), { status: 200 });
      }
      if (url.startsWith("/api/payment-methods")) {
        return new Response(JSON.stringify({ paymentMethods: methods }), { status: 200 });
      }
      return new Response(JSON.stringify({ fees }), { status: 200 });
    }
    return writeResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function writes(): Call[] {
  return calls.filter((call) => call.method !== "GET");
}

async function openPage() {
  renderAt("/cadastros/taxas");
  await screen.findByRole("heading", { name: "PagSeguro" });
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.submit(screen.getByLabelText("Taxa (%)").closest("form") as HTMLFormElement);
}

describe("Tabela de taxas (FR-15)", () => {
  it("FR-15: Cadastros links to payment methods, card machines and the fee table", () => {
    renderAt("/cadastros");
    expect(screen.getByRole("link", { name: /Formas de pagamento/ })).toHaveAttribute(
      "href",
      "/cadastros/formas-pagamento",
    );
    expect(screen.getByRole("link", { name: /Maquininhas/ })).toHaveAttribute(
      "href",
      "/cadastros/maquininhas",
    );
    expect(screen.getByRole("link", { name: /Tabela de taxas/ })).toHaveAttribute(
      "href",
      "/cadastros/taxas",
    );
  });

  it("FR-15: lists the rows per machine with range, rate, date and status", async () => {
    await openPage();
    const section = screen
      .getByRole("heading", { name: "PagSeguro" })
      .closest("section") as HTMLElement;
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Cartão de débito1x1,49%01\/01\/2020Em vigor/),
      expect.stringMatching(/Cartão de débito1x1,99%01\/01\/2019Substituída/),
      expect.stringMatching(/Cartão de crédito2–6x4,59%01\/12\/2099Futura/),
      expect.stringMatching(/Cartão de crédito2–6x4,99%01\/01\/2020Em vigor/),
    ]);
    // Mercado Pago has no rows yet.
    const mercadoPago = screen
      .getByRole("heading", { name: "Mercado Pago" })
      .closest("section") as HTMLElement;
    expect(within(mercadoPago).getByText(/Nenhuma taxa/)).toBeInTheDocument();
  });

  it("FR-15: the form offers only active machines and methods that use a machine", async () => {
    await openPage();
    const machineOptions = within(screen.getByLabelText("Maquininha")).getAllByRole("option");
    expect(machineOptions.map((option) => option.textContent)).toEqual([
      "Escolha…",
      "PagSeguro",
      "Mercado Pago",
    ]);
    const methodOptions = within(screen.getByLabelText("Forma de pagamento")).getAllByRole(
      "option",
    );
    expect(methodOptions.map((option) => option.textContent)).toEqual([
      "Escolha…",
      "Cartão de débito",
      "Cartão de crédito",
      "PIX/Depósito",
    ]);
    expect(screen.getByLabelText("Vigente desde")).toHaveValue(todayCivilDate());
  });

  it("FR-15: installments are locked to 1x for a method without installments", async () => {
    await openPage();
    fill("Forma de pagamento", "2");
    expect(screen.getByLabelText("Parcelas de")).toBeDisabled();
    expect(screen.getByLabelText("Parcelas até")).toHaveValue(1);
    fill("Forma de pagamento", "3");
    expect(screen.getByLabelText("Parcelas de")).toBeEnabled();
  });

  it("FR-15: Enter saves a new row and focus returns to the first field", async () => {
    await openPage();
    fill("Maquininha", "2");
    fill("Forma de pagamento", "3");
    fill("Parcelas de", "2");
    fill("Parcelas até", "6");
    fill("Taxa (%)", "4,99");
    fill("Vigente desde", "2026-12-01");
    submit();

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          url: "/api/card-fees",
          body: {
            cardMachineId: 2,
            paymentMethodId: 3,
            installmentsFrom: 2,
            installmentsTo: 6,
            ratePpm: 49900,
            validFrom: "2026-12-01",
          },
        },
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText("Taxa (%)")).toHaveValue(""));
    expect(screen.getByLabelText("Maquininha")).toHaveFocus();
  });

  it("FR-15: shows a pt-BR message for an invalid rate", async () => {
    await openPage();
    fill("Maquininha", "1");
    fill("Forma de pagamento", "2");
    fill("Taxa (%)", "4,99999");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe a taxa em %, por exemplo 3,79 (até 4 casas decimais, de 0 a 100).",
    );
    expect(writes()).toEqual([]);
  });

  it("FR-15: blocks an overlapping range before calling the server", async () => {
    await openPage();
    fill("Maquininha", "1");
    fill("Forma de pagamento", "3");
    fill("Parcelas de", "6");
    fill("Parcelas até", "12");
    fill("Taxa (%)", "5,99");
    fill("Vigente desde", "2020-01-01");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Já existe uma taxa para PagSeguro / Cartão de crédito / 2–6x vigente desde 01/01/2020.",
    );
    expect(writes()).toEqual([]);
  });

  it("FR-15: edits a row in the same form, and Esc cancels", async () => {
    writeResponse = () =>
      new Response(JSON.stringify({ ...fees[3], ratePpm: 48900 }), { status: 200 });
    await openPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar PagSeguro / Cartão de crédito / 2–6x desde 01/01/2020",
      }),
    );
    expect(screen.getByLabelText("Taxa (%)")).toHaveValue("4,99");
    expect(screen.getByLabelText("Maquininha")).toHaveFocus();

    fireEvent.keyDown(screen.getByLabelText("Taxa (%)"), { key: "Escape" });
    expect(screen.getByLabelText("Taxa (%)")).toHaveValue("");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar PagSeguro / Cartão de crédito / 2–6x desde 01/01/2020",
      }),
    );
    fill("Taxa (%)", "4,89");
    submit();
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          url: "/api/card-fees/10",
          body: {
            cardMachineId: 1,
            paymentMethodId: 3,
            installmentsFrom: 2,
            installmentsTo: 6,
            ratePpm: 48900,
            validFrom: "2020-01-01",
          },
        },
      ]),
    );
  });

  it("FR-15: deletes a row after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    writeResponse = () => new Response(null, { status: 204 });
    await openPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Excluir PagSeguro / Cartão de crédito / 2–6x desde 01/01/2020",
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([{ method: "DELETE", url: "/api/card-fees/10", body: undefined }]),
    );
  });

  it("FR-15: deleting the row being edited leaves edit mode", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    writeResponse = () => new Response(null, { status: 204 });
    await openPage();
    const name = "PagSeguro / Cartão de crédito / 2–6x desde 01/01/2020";
    fireEvent.click(screen.getByRole("button", { name: `Editar ${name}` }));
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Excluir ${name}` }));
    expect(await screen.findByRole("button", { name: "Adicionar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Taxa (%)")).toHaveValue("");
  });

  it("FR-15: editing a row keeps its stored range when the method no longer allows installments", async () => {
    methods[2] = { ...methods[2]!, allowsInstallments: false };
    try {
      writeResponse = () =>
        new Response(
          JSON.stringify({ error: "Cartão de crédito não permite parcelas: use a faixa 1x." }),
          {
            status: 400,
          },
        );
      await openPage();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Editar PagSeguro / Cartão de crédito / 2–6x desde 01/01/2020",
        }),
      );
      expect(screen.getByLabelText("Parcelas de")).toHaveValue(2);
      expect(screen.getByLabelText("Parcelas até")).toHaveValue(6);
      fill("Taxa (%)", "4,89");
      submit();
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]?.body).toMatchObject({ installmentsFrom: 2, installmentsTo: 6 });
      expect(await screen.findByRole("alert")).toHaveTextContent("não permite parcelas");
    } finally {
      methods[2] = { ...methods[2]!, allowsInstallments: true };
    }
  });

  it("RN-01: rows of an inactive machine show as Sem uso", async () => {
    fees.push({
      id: 20,
      cardMachineId: 3,
      paymentMethodId: 2,
      installmentsFrom: 1,
      installmentsTo: 1,
      ratePpm: 19900,
      validFrom: "2020-01-01",
    });
    await openPage();
    const section = (await screen.findByRole("heading", { name: /Cielo antiga/ })).closest(
      "section",
    ) as HTMLElement;
    expect(within(section).getByText("Sem uso")).toBeInTheDocument();
    expect(within(section).queryByText("Em vigor")).toBeNull();
  });
});
