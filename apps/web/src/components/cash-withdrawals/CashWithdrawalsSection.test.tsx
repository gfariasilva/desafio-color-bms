import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CashWithdrawal, DayCashWithdrawalsResponse } from "@color-bms/core";
import { CashWithdrawalsSection } from "./CashWithdrawalsSection";

const TODAY = "2026-11-18";

function withdrawal(overrides: Partial<CashWithdrawal> = {}): CashWithdrawal {
  return {
    id: 1,
    date: TODAY,
    createdAt: "2026-11-18T13:05:00.000Z",
    amountCents: 30000,
    note: "depósito no banco",
    ...overrides,
  };
}

let withdrawals: CashWithdrawal[];
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
  withdrawals = [];
  dayLock = null;
  postResponse = () => json(withdrawal({ id: 99 }), 201);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return postResponse();
    }
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return json(withdrawal({ amountCents: 25000 }));
    }
    if (init?.method === "DELETE") {
      deletes.push(url);
      return new Response(null, { status: 204 });
    }
    const day = /^\/api\/days\/([\d-]+)\/cash-withdrawals/.exec(url);
    if (day) {
      const ofDay = withdrawals.filter((item) => item.date === day[1]);
      const response: DayCashWithdrawalsResponse = {
        date: day[1]!,
        lock: dayLock,
        withdrawals: ofDay,
        totalCents: ofDay.reduce((total, item) => total + item.amountCents, 0),
      };
      return json(response);
    }
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderSection(date: string | null = TODAY) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CashWithdrawalsSection date={date} today={TODAY} />
    </QueryClientProvider>,
  );
  if (date) await screen.findByText(/Nenhuma sangria neste dia|Total de sangrias/);
}

const value = () => screen.getByLabelText("Valor da sangria (R$)");
const note = () => screen.getByLabelText("Observação");

function submit() {
  fireEvent.submit(value().closest("form") as HTMLFormElement);
}

describe("FR-07: sangrias on the Despesas page", () => {
  it("FR-07: says clearly that a sangria is not an expense", async () => {
    await renderSection();
    expect(screen.getByRole("heading", { name: "Sangrias de 18/11/2026" })).toBeInTheDocument();
    expect(screen.getByText("Não é despesa")).toBeInTheDocument();
    expect(screen.getByText(/não entra nas despesas nem no saldo do mês/)).toBeInTheDocument();
  });

  it('FR-07: registers R$ 300,00 "depósito no banco" on the page\'s date; clears the form and returns focus to Valor', async () => {
    await renderSection();
    fireEvent.change(value(), { target: { value: "300" } });
    fireEvent.change(note(), { target: { value: "depósito no banco" } });
    submit();

    expect(await screen.findByRole("status")).toHaveTextContent("Sangria de R$ 300,00 registrada.");
    expect(posts).toEqual([{ date: TODAY, amountCents: 30000, note: "depósito no banco" }]);
    expect(value()).toHaveValue("");
    expect(note()).toHaveValue("");
    expect(value()).toHaveFocus();
  });

  it("FR-07: explains an invalid or zero value without calling the server", async () => {
    await renderSection();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o valor da sangria, por exemplo 300,00.",
    );
    fireEvent.change(value(), { target: { value: "0" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe um valor maior que zero.");
    expect(posts).toEqual([]);
  });

  it("FR-07: shows the server's message (e.g. a closed day)", async () => {
    postResponse = () =>
      json(
        {
          error:
            "O dia 18/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
          code: "day_closed",
        },
        409,
      );
    await renderSection();
    fireEvent.change(value(), { target: { value: "10" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("O dia 18/11/2026 está fechado.");
  });

  it("FR-07: lists the day's sangrias with their total", async () => {
    withdrawals = [
      withdrawal(),
      withdrawal({ id: 2, amountCents: 5050, note: null, createdAt: "2026-11-18T19:00:00.000Z" }),
    ];
    await renderSection();
    const table = screen.getByRole("table", { name: "Sangrias do dia" });
    expect(within(table).getByText("depósito no banco")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Total de sangrias/ })).toHaveTextContent(
      /R\$\s350,50/,
    );
  });

  it("FR-07: Editar loads the sangria into the form and saves the change", async () => {
    withdrawals = [withdrawal()];
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Editar sangria das 10:05/ }));
    expect(screen.getByRole("form", { name: "Editar sangria" })).toBeInTheDocument();
    expect(value()).toHaveValue("300,00");
    expect(note()).toHaveValue("depósito no banco");
    fireEvent.change(value(), { target: { value: "250" } });
    submit();
    expect(await screen.findByRole("status")).toHaveTextContent("Sangria alterada.");
    expect(patches).toEqual([
      { url: "/api/cash-withdrawals/1", body: { amountCents: 25000, note: "depósito no banco" } },
    ]);
    expect(screen.getByRole("form", { name: "Nova sangria" })).toBeInTheDocument();
  });

  it("FR-07: Esc cancels the edit without saving", async () => {
    withdrawals = [withdrawal()];
    await renderSection();
    fireEvent.change(value(), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /Editar sangria/ }));
    fireEvent.keyDown(value(), { key: "Escape" });
    expect(screen.getByRole("form", { name: "Nova sangria" })).toBeInTheDocument();
    // The sangria being typed before "Editar" comes back.
    expect(value()).toHaveValue("12");
    expect(patches).toEqual([]);
  });

  it("FR-07: Excluir asks for confirmation before deleting", async () => {
    withdrawals = [withdrawal()];
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await renderSection();
    const button = screen.getByRole("button", { name: /Excluir sangria/ });
    fireEvent.click(button);
    expect(deletes).toEqual([]);
    fireEvent.click(button);
    await waitFor(() => expect(deletes).toEqual(["/api/cash-withdrawals/1"]));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Excluir a sangria de R\$\s300,00\? A exclusão fica registrada na auditoria\.$/,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Sangria excluída.");
  });

  it("RN-14: on a closed day, editing and deleting are blocked with the reopen hint", async () => {
    withdrawals = [withdrawal()];
    dayLock = "O dia 18/11/2026 está fechado. Reabra o dia para alterar ou excluir esta sangria.";
    const confirm = vi.spyOn(window, "confirm");
    await renderSection();
    expect(screen.getByText("Dia fechado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Editar sangria/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(dayLock);
    expect(screen.getByRole("form", { name: "Nova sangria" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Excluir sangria/ }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("FR-07: an edit keeps the sangria's date, even if the page's date is cleared", async () => {
    withdrawals = [withdrawal()];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CashWithdrawalsSection date={TODAY} today={TODAY} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Editar sangria/ }));
    rerender(
      <QueryClientProvider client={queryClient}>
        <CashWithdrawalsSection date={null} today={TODAY} />
      </QueryClientProvider>,
    );
    fireEvent.change(value(), { target: { value: "250" } });
    submit();
    expect(await screen.findByRole("status")).toHaveTextContent("Sangria alterada.");
    expect(patches).toHaveLength(1);
  });

  it("FR-07: a message about one day is cleared when the page moves to another day", async () => {
    withdrawals = [withdrawal()];
    dayLock = "O dia 18/11/2026 está fechado. Reabra o dia para alterar ou excluir esta sangria.";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CashWithdrawalsSection date={TODAY} today={TODAY} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Editar sangria/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("está fechado");
    rerender(
      <QueryClientProvider client={queryClient}>
        <CashWithdrawalsSection date="2026-11-17" today={TODAY} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("FR-07: without a valid date on the page, nothing is sent", async () => {
    await renderSection(null);
    fireEvent.change(value(), { target: { value: "10" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha uma data válida");
    expect(posts).toEqual([]);
  });
});
