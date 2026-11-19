import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCents, type DayCashClosingResponse } from "@color-bms/core";
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

/**
 * formatCents for page text: Testing Library collapses whitespace in the page (formatCents'
 * non-breaking space becomes a normal space), so the expected text uses a normal space too.
 */
const money = (cents: number) => formatCents(cents).replace(/\s/g, " ");

/** The full day of the server tests: RN-07 expects 125,00 + 40,00 − 45,00 − 30,00 = 90,00. */
function openDay(overrides: Partial<DayCashClosingResponse> = {}): DayCashClosingResponse {
  return {
    date: TODAY,
    status: "open",
    hasMovement: true,
    blocked: null,
    suggestedOpeningCashCents: 12500,
    suggestedFrom: "2026-11-17",
    cashSalesCents: 4000,
    tillExpensesCents: 4500,
    withdrawalsCents: 3000,
    closing: null,
    ...overrides,
  };
}

function closedDay(body: { openingCashCents: number; countedCashCents: number; note?: string }) {
  const expected = body.openingCashCents + 4000 - 4500 - 3000;
  return openDay({
    status: "closed",
    blocked: "O dia 18/11/2026 já está fechado.",
    closing: {
      openingCashCents: body.openingCashCents,
      expectedCashCents: expected,
      countedCashCents: body.countedCashCents,
      differenceCents: body.countedCashCents - expected,
      note: body.note ?? null,
      closedAt: "2026-11-18T21:30:00.000Z",
    },
  });
}

let day: DayCashClosingResponse;
const posts: { url: string; body: unknown }[] = [];
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  posts.length = 0;
  day = openDay();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Parameters<typeof closedDay>[0];
      posts.push({ url, body });
      day = closedDay(body);
      return json(day);
    }
    if (/^\/api\/days\/[\d-]+\/cash-closing/.test(url)) return json(day);
    if (url.startsWith("/api/today")) return json({ date: TODAY });
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const opening = () => screen.getByLabelText("Troco inicial (R$)");
const counted = () => screen.getByLabelText("Dinheiro contado (R$)");
const note = () => screen.getByLabelText("Observação");

async function openPage(path = "/fechamento") {
  renderAt(path);
  await screen.findByRole("form", { name: "Fechar o dia" });
}

function submit() {
  fireEvent.submit(screen.getByRole("form", { name: "Fechar o dia" }));
}

describe("FR-08: close the day (Fechamento page)", () => {
  it("FR-08: shows the RN-07 terms, with the opening cash pre-filled from the last count", async () => {
    await openPage();
    expect(opening()).toHaveValue("125,00");
    expect(opening()).toHaveFocus();
    expect(screen.getByText("Contado no fechamento de 17/11/2026.")).toBeInTheDocument();
    expect(screen.getByTestId("cash-sales")).toHaveTextContent(money(4000));
    expect(screen.getByTestId("till-expenses")).toHaveTextContent(money(4500));
    expect(screen.getByTestId("withdrawals")).toHaveTextContent(money(3000));
    expect(screen.getByTestId("expected-cash")).toHaveTextContent(money(9000));

    // The opening cash is editable; the expected cash follows it.
    fireEvent.change(opening(), { target: { value: "100,00" } });
    expect(screen.getByTestId("expected-cash")).toHaveTextContent(money(6500));
  });

  it("FR-08: first day of use: the opening cash starts empty and must be typed", async () => {
    day = openDay({ suggestedOpeningCashCents: null, suggestedFrom: null });
    await openPage();
    expect(opening()).toHaveValue("");
    expect(screen.getByText("Primeiro fechamento: digite o troco inicial.")).toBeInTheDocument();

    fireEvent.change(counted(), { target: { value: "90,00" } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o troco inicial.");
    expect(posts).toEqual([]);
  });

  it("FR-08: with no difference, Enter closes the day at once", async () => {
    await openPage();
    fireEvent.change(counted(), { target: { value: "90,00" } });
    expect(screen.getByTestId("difference")).toHaveTextContent("Sem diferença");
    submit();

    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: `/api/days/${TODAY}/close`,
          body: {
            openingCashCents: 12500,
            countedCashCents: 9000,
            expectedCashCents: 9000,
            note: null,
          },
        },
      ]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Dia 18/11/2026 fechado.");
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
  });

  it("FR-08: a non-zero difference is highlighted and asks for confirmation and an optional note", async () => {
    await openPage();
    fireEvent.change(counted(), { target: { value: "85,00" } });
    expect(screen.getByTestId("difference")).toHaveTextContent(`Falta de ${money(500)}`);

    submit();
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(`Falta de ${money(500)}`);
    expect(note()).toHaveFocus();
    expect(screen.getByRole("button", { name: "Fechar mesmo assim" })).toBeInTheDocument();
    expect(posts).toEqual([]);

    fireEvent.change(note(), { target: { value: "faltou troco" } });
    submit();
    await waitFor(() =>
      expect(posts.map((post) => post.body)).toEqual([
        {
          openingCashCents: 12500,
          countedCashCents: 8500,
          expectedCashCents: 9000,
          note: "faltou troco",
        },
      ]),
    );
  });

  it("FR-08: a surplus is shown as sobra; changing a value asks for confirmation again", async () => {
    await openPage();
    fireEvent.change(counted(), { target: { value: "91,00" } });
    expect(screen.getByTestId("difference")).toHaveTextContent(`Sobra de ${money(100)}`);
    submit();
    await screen.findByRole("button", { name: "Fechar mesmo assim" });

    fireEvent.change(counted(), { target: { value: "92,00" } });
    expect(screen.queryByRole("button", { name: "Fechar mesmo assim" })).not.toBeInTheDocument();
    submit();
    await screen.findByRole("button", { name: "Fechar mesmo assim" });
    expect(posts).toEqual([]);
  });

  it("FR-08: Esc leaves the confirmation and returns to the counted cash", async () => {
    await openPage();
    fireEvent.change(counted(), { target: { value: "85,00" } });
    submit();
    await screen.findByRole("button", { name: "Fechar mesmo assim" });
    fireEvent.keyDown(note(), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Fechar mesmo assim" })).not.toBeInTheDocument();
    expect(counted()).toHaveFocus();
  });

  it("FR-08: the counted cash is required", async () => {
    await openPage();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o dinheiro contado.");
    expect(posts).toEqual([]);
  });

  it("FR-08: a closed day shows the stored closing, read-only", async () => {
    day = closedDay({ openingCashCents: 12500, countedCashCents: 8500, note: "faltou troco" });
    renderAt("/fechamento");
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Fechar o dia" })).not.toBeInTheDocument();
    expect(screen.getByTestId("expected-cash")).toHaveTextContent(money(9000));
    expect(screen.getByTestId("counted-cash")).toHaveTextContent(money(8500));
    expect(screen.getByTestId("difference")).toHaveTextContent(`Falta de ${money(500)}`);
    expect(screen.getByText("faltou troco")).toBeInTheDocument();
    expect(screen.getByText(/Fechado em 18\/11\/2026 18:30/)).toBeInTheDocument();
  });

  it("A-15: a day without movement says why it is not closed", async () => {
    day = openDay({
      hasMovement: false,
      blocked: "Este dia não tem movimento e não precisa ser fechado.",
    });
    renderAt("/fechamento");
    expect(
      await screen.findByText("Este dia não tem movimento e não precisa ser fechado."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Fechar o dia" })).not.toBeInTheDocument();
  });

  it("FR-27: opens the day given in the link (?data=)", async () => {
    await openPage("/fechamento?data=2026-11-16");
    expect(screen.getByLabelText("Data")).toHaveValue("2026-11-16");
    expect(fetchMock).toHaveBeenCalledWith("/api/days/2026-11-16/cash-closing", expect.anything());
  });
});
