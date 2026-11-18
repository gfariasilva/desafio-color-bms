import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceGroup, type ChoiceOption } from "./choice-group";

const OPTIONS: ChoiceOption[] = [
  { value: 1, label: "Acessórios" },
  { value: 2, label: "Carimbos" },
  { value: 3, label: "Cartuchos compatíveis" },
  { value: 7, label: "Toner" },
];

function Harness({ onSubmit = vi.fn(), disabled = false }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <ChoiceGroup
        label="Aba"
        options={OPTIONS}
        value={value}
        onChange={setValue}
        disabled={disabled}
      />
    </form>
  );
}

function radio(name: string) {
  return screen.getByRole("radio", { name: new RegExp(name) });
}

function checkedName(): string | null {
  return (
    screen
      .getAllByRole("radio")
      .find((element) => element.getAttribute("aria-checked") === "true")
      ?.textContent?.replace(/^\d/, "") ?? null
  );
}

describe("ChoiceGroup (NFR-05: keyboard-first choice of tab and payment method)", () => {
  it("is a labelled radio group showing the digit of each option", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Aba" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((element) => element.textContent)).toEqual([
      "1Acessórios",
      "2Carimbos",
      "3Cartuchos compatíveis",
      "4Toner",
    ]);
  });

  it("has one tab stop: the checked option, or the first one", () => {
    render(<Harness />);
    const tabbable = () => screen.getAllByRole("radio").filter((element) => element.tabIndex === 0);
    expect(tabbable()).toEqual([radio("Acessórios")]);
    fireEvent.keyDown(radio("Acessórios"), { key: "4" });
    expect(tabbable()).toEqual([radio("Toner")]);
  });

  it("a digit picks the option with that number and focuses it", () => {
    render(<Harness />);
    radio("Acessórios").focus();
    fireEvent.keyDown(radio("Acessórios"), { key: "4" });
    expect(checkedName()).toBe("Toner");
    expect(radio("Toner")).toHaveFocus();
  });

  it("ignores digits without an option", () => {
    render(<Harness />);
    fireEvent.keyDown(radio("Acessórios"), { key: "9" });
    expect(checkedName()).toBeNull();
  });

  it("typing letters jumps to the first name that starts with them (accents ignored)", () => {
    render(<Harness />);
    const first = radio("Acessórios");
    fireEvent.keyDown(first, { key: "t" });
    expect(checkedName()).toBe("Toner");
    fireEvent.keyDown(radio("Toner"), { key: "c" });
    fireEvent.keyDown(radio("Carimbos"), { key: "a" });
    fireEvent.keyDown(radio("Carimbos"), { key: "r" });
    fireEvent.keyDown(radio("Carimbos"), { key: "t" });
    expect(checkedName()).toBe("Cartuchos compatíveis");
  });

  it("arrows move and select, wrapping around", () => {
    render(<Harness />);
    fireEvent.keyDown(radio("Acessórios"), { key: "ArrowRight" });
    expect(checkedName()).toBe("Carimbos");
    fireEvent.keyDown(radio("Carimbos"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio("Acessórios"), { key: "ArrowLeft" });
    expect(checkedName()).toBe("Toner");
  });

  it("a click selects", () => {
    render(<Harness />);
    fireEvent.click(radio("Carimbos"));
    expect(checkedName()).toBe("Carimbos");
  });

  it("Enter submits the form", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.keyDown(radio("Acessórios"), { key: "2" });
    fireEvent.keyDown(radio("Carimbos"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(2);
  });

  it("a disabled group cannot be focused or changed", () => {
    render(<Harness disabled />);
    for (const element of screen.getAllByRole("radio")) expect(element).toBeDisabled();
  });
});
