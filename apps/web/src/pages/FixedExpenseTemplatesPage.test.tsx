import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedExpenseTemplate } from "@color-bms/core";
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

function template(
  id: number,
  name: string,
  changes: Partial<FixedExpenseTemplate> = {},
): FixedExpenseTemplate {
  return {
    id,
    name,
    group: "general",
    subgroup: null,
    dueDay: null,
    expectedAmountCents: null,
    isLoan: false,
    installmentsTotal: null,
    installmentsRemaining: null,
    order: id,
    active: true,
    ...changes,
  };
}

let templates: FixedExpenseTemplate[] = [];

interface Call {
  method: string;
  url: string;
  body: unknown;
}
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  calls.length = 0;
  templates = [
    template(1, "Luz", { dueDay: 10, expectedAmountCents: 20000 }),
    template(2, "Vivo fixo", { subgroup: "Telefonia" }),
    template(3, "Empréstimos", { isLoan: true }),
    template(4, "Empréstimo Caixa", {
      isLoan: true,
      installmentsTotal: 10,
      installmentsRemaining: 7,
    }),
    template(5, "DAS", { group: "government_fees", dueDay: 20 }),
    template(6, "TFE", { group: "government_fees", active: false }),
  ];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "PUT") {
      return new Response(JSON.stringify({ templates }), { status: 200 });
    }
    if (method === "GET") {
      return new Response(JSON.stringify({ templates }), { status: 200 });
    }
    const status = method === "POST" ? 201 : 200;
    return new Response(JSON.stringify(templates[0]), { status });
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
  renderAt("/despesas-fixas/modelos");
  await screen.findByRole("heading", { name: "Gerais" });
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.submit(screen.getByLabelText("Nome").closest("form") as HTMLFormElement);
}

function section(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("section") as HTMLElement;
}

describe("Despesas fixas › Modelos (FR-10)", () => {
  it("FR-10: Despesas fixas links to the templates page", () => {
    renderAt("/despesas-fixas");
    expect(screen.getByRole("link", { name: /Modelos/ })).toHaveAttribute(
      "href",
      "/despesas-fixas/modelos",
    );
  });

  it("FR-10: lists the templates per group with due day, amount, installments and status", async () => {
    await openPage();
    const general = within(section("Gerais")).getAllByRole("row").slice(1);
    expect(general.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Luzdia 10R\$\s200,00—Ativo/),
      expect.stringMatching(/^Telefonia – Vivo fixoa preencher——Ativo/),
      expect.stringMatching(/^Empréstimosa preencher—a preencherAtivo/),
      expect.stringMatching(/^Empréstimo Caixaa preencher—7 de 10 restantesAtivo/),
    ]);
    const fees = within(section("Taxas governo")).getAllByRole("row").slice(1);
    expect(fees.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^DASdia 20——Ativo/),
      expect.stringMatching(/^TFEa preencher——Inativo/),
    ]);
  });

  it("FR-10: the installment fields only apply to loans", async () => {
    await openPage();
    expect(screen.getByLabelText("Total de parcelas")).toBeDisabled();
    expect(screen.getByLabelText("Parcelas restantes")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Empréstimo"));
    expect(screen.getByLabelText("Total de parcelas")).toBeEnabled();
    expect(screen.getByLabelText("Parcelas restantes")).toBeEnabled();
  });

  it("FR-10: adds a template and returns focus to Nome", async () => {
    await openPage();
    fill("Nome", "Internet");
    fill("Subgrupo", "Telefonia");
    fill("Dia de vencimento", "15");
    fill("Valor previsto (R$)", "99,90");
    submit();

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      url: "/api/fixed-expense-templates",
      body: {
        name: "Internet",
        group: "general",
        subgroup: "Telefonia",
        dueDay: 15,
        expectedAmountCents: 9990,
        isLoan: false,
        installmentsTotal: null,
        installmentsRemaining: null,
      },
    });
    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveFocus());
    expect(screen.getByLabelText("Nome")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Modelo Telefonia – Internet adicionado.");
  });

  it("FR-10: adds a loan with its installments", async () => {
    await openPage();
    fill("Nome", "Empréstimo Itaú");
    fill("Dia de vencimento", "5");
    fireEvent.click(screen.getByLabelText("Empréstimo"));
    fill("Total de parcelas", "24");
    fill("Parcelas restantes", "24");
    submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toMatchObject({
      isLoan: true,
      installmentsTotal: 24,
      installmentsRemaining: 24,
      expectedAmountCents: null,
    });
  });

  it("FR-10: shows the pt-BR validation message and sends nothing", async () => {
    await openPage();
    fill("Nome", "Internet");
    fill("Dia de vencimento", "32");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O dia de vencimento deve ser de 1 a 31.",
    );

    fill("Dia de vencimento", "10");
    fill("Valor previsto (R$)", "abc");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o valor previsto, por exemplo 200,00, ou deixe em branco.",
    );
    expect(writes()).toHaveLength(0);
  });

  it("FR-10: blocks a duplicate name, ignoring case and accents", async () => {
    await openPage();
    fill("Nome", "VIVO FIXO");
    fill("Subgrupo", "telefonia");
    fill("Dia de vencimento", "10");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Já existe um modelo de despesa fixa com esse nome.",
    );
    expect(writes()).toHaveLength(0);
  });

  it("FR-10: Editar loads the template into the form and Salvar sends every field", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Editar Empréstimo Caixa" }));
    expect(screen.getByRole("form", { name: "Editar modelo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("Empréstimo Caixa");
    expect(screen.getByLabelText("Empréstimo")).toBeChecked();
    expect(screen.getByLabelText("Parcelas restantes")).toHaveValue(7);

    fill("Dia de vencimento", "8");
    submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      url: "/api/fixed-expense-templates/4",
      body: {
        name: "Empréstimo Caixa",
        group: "general",
        subgroup: null,
        dueDay: 8,
        expectedAmountCents: null,
        isLoan: true,
        installmentsTotal: 10,
        installmentsRemaining: 7,
      },
    });
  });

  it("FR-10: Esc cancels an edit", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Editar Luz" }));
    fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Escape" });
    expect(screen.getByRole("form", { name: "Novo modelo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("");
  });

  it("FR-10: deactivates and reactivates a template", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Desativar Luz" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      url: "/api/fixed-expense-templates/1",
      body: { active: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reativar TFE" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]?.body).toEqual({ active: true });
  });

  it("FR-10: reorders within the group", async () => {
    await openPage();
    // DAS is the first of Taxas governo: it cannot move up into Gerais.
    expect(screen.getByRole("button", { name: "Mover DAS para cima" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mover TFE para cima" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      url: "/api/fixed-expense-templates/order",
      body: { ids: [1, 2, 3, 4, 6, 5] },
    });
  });

  it("FR-10: templates have no delete button", async () => {
    await openPage();
    expect(screen.queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
  });
});
