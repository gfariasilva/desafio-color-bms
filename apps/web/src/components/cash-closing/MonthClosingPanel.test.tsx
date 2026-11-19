import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { FixedExpense, MonthClosingResponse } from "@color-bms/core";
import { ROUTER_FUTURE } from "@/App";
import { MonthClosingPanel } from "./MonthClosingPanel";

const TODAY = "2026-11-18";

function openMonth(overrides: Partial<MonthClosingResponse> = {}): MonthClosingResponse {
  return {
    yearMonth: "2026-10",
    status: "open",
    closedAt: null,
    lastDate: "2026-10-31",
    pendingDays: [],
    pendingFixedExpenses: [],
    closeBlocked: null,
    ...overrides,
  };
}

function bill(id: number, label: string, dueDate: string | null): FixedExpense {
  return {
    id,
    referenceMonth: "2026-10",
    label,
    group: "general",
    fixedExpenseTemplateId: null,
    oneOff: true,
    dueDate,
    expectedAmountCents: 15000,
    status: "pending",
    amountCents: null,
    paymentDate: null,
    paymentMeans: null,
    paidFromTill: false,
    installmentNumber: null,
    installmentsTotal: null,
    createdAt: "2026-10-01T12:00:00.000Z",
  };
}

function renderPanel(
  month: MonthClosingResponse,
  handlers: Partial<{ onClose: () => Promise<unknown>; onReopen: () => Promise<unknown> }> = {},
) {
  const onClose = vi.fn(handlers.onClose ?? (() => Promise.resolve()));
  const onReopen = vi.fn(handlers.onReopen ?? (() => Promise.resolve()));
  render(
    <MemoryRouter future={ROUTER_FUTURE}>
      <MonthClosingPanel month={month} today={TODAY} onClose={onClose} onReopen={onReopen} />
    </MemoryRouter>,
  );
  return { onClose, onReopen };
}

describe("FR-16: close the month (panel)", () => {
  it("FR-16: 'Fechar mês' asks 'Tem certeza?' with focus on the confirm button; Enter confirms", async () => {
    const { onClose } = renderPanel(openMonth());
    fireEvent.click(screen.getByRole("button", { name: "Fechar mês" }));
    const group = screen.getByRole("group", { name: "Fechar o mês" });
    expect(group).toHaveTextContent("Tem certeza? O mês 10/2026 será fechado");
    const confirm = screen.getByRole("button", { name: "Confirmar fechamento" });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("FR-16: Esc cancels and returns focus to 'Fechar mês'", () => {
    const { onClose } = renderPanel(openMonth());
    fireEvent.click(screen.getByRole("button", { name: "Fechar mês" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Confirmar fechamento" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("group", { name: "Fechar o mês" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fechar mês" })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("FR-16: a refusal from the server is shown in the card", async () => {
    renderPanel(openMonth(), {
      onClose: () => Promise.reject(new Error("O mês 10/2026 já está fechado.")),
    });
    fireEvent.click(screen.getByRole("button", { name: "Fechar mês" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar fechamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O mês 10/2026 já está fechado.");
  });

  it("FR-16: lists the pending days as links to their closing and offers no 'Fechar mês'", () => {
    renderPanel(
      openMonth({
        pendingDays: ["2026-10-03", "2026-10-31"],
        closeBlocked: "Feche os dias … 03/10/2026, 31/10/2026.",
      }),
    );
    const list = screen.getByRole("list", { name: "Dias pendentes" });
    const links = Array.from(list.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual(["03/10/2026", "31/10/2026"]);
    expect(links[0]).toHaveAttribute("href", "/fechamento?data=2026-10-03");
    expect(screen.queryByRole("button", { name: "Fechar mês" })).toBeNull();
  });

  it("FR-16: before the last day, only says when the month can be closed", () => {
    renderPanel(
      openMonth({
        yearMonth: "2026-11",
        lastDate: "2026-11-30",
        pendingDays: ["2026-11-18"],
        closeBlocked:
          "O mês 11/2026 ainda não terminou. Ele pode ser fechado a partir de 30/11/2026.",
      }),
    );
    expect(screen.getByText(/ainda não terminou/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Dias pendentes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar mês" })).toBeNull();
  });

  it("FR-16: warns about the pending fixed expenses but still offers 'Fechar mês'", () => {
    renderPanel(
      openMonth({ pendingFixedExpenses: [bill(1, "TFE", "2026-10-10"), bill(2, "IPTU", null)] }),
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("2 despesas fixas de 10/2026 ainda estão pendentes.");
    expect(note).toHaveTextContent("elas continuam pendentes e entram no mês em que forem pagas");
    expect(note).toHaveTextContent("TFE — vence 10/10/2026");
    expect(note).toHaveTextContent("IPTU —");
    expect(screen.getByRole("button", { name: "Fechar mês" })).toBeEnabled();
  });
});

describe("FR-17: reopen the month (panel)", () => {
  const closed = openMonth({ status: "closed", closedAt: "2026-11-18T18:00:00.000Z" });

  it("FR-17: a closed month shows when it was closed and 'Reabrir mês'", () => {
    renderPanel(closed);
    expect(screen.getByText("Mês fechado")).toBeInTheDocument();
    expect(screen.getByText("Fechado em 18/11/2026 15:00.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar mês" })).toBeNull();
  });

  it("FR-17: 'Reabrir mês' asks for confirmation and a reason; the reason is required", async () => {
    const { onReopen } = renderPanel(closed);
    fireEvent.click(screen.getByRole("button", { name: "Reabrir mês" }));
    const form = screen.getByRole("form", { name: "Reabrir o mês" });
    expect(form).toHaveTextContent("Os dias continuam fechados até serem reabertos um a um.");
    const reason = screen.getByLabelText("Motivo da reabertura");
    expect(reason).toHaveFocus();

    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o motivo da reabertura.");
    expect(onReopen).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: " lançamento esquecido " } });
    fireEvent.submit(form);
    await waitFor(() => expect(onReopen).toHaveBeenCalledWith({ reason: "lançamento esquecido" }));
  });
});
