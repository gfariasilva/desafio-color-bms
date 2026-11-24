import { lazy } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyPage } from "./LazyPage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LazyPage", () => {
  it("shows the page once its file has loaded", async () => {
    const Page = lazy(async () => ({ default: () => <h1>Dashboards</h1> }));
    render(
      <LazyPage name="Dashboards">
        <Page />
      </LazyPage>,
    );
    expect(await screen.findByRole("heading", { name: "Dashboards" })).toBeVisible();
  });

  it("shows a pt-BR message instead of a blank app when the page's file fails to load", async () => {
    // React logs the caught error; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Page = lazy(() =>
      Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
    );
    render(
      <LazyPage name="Dashboards">
        <Page />
      </LazyPage>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível abrir os Dashboards. Recarregue a página (F5).",
    );
  });
});
